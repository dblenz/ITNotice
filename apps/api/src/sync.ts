import { setEmployeeAudiences, upsertAudience, upsertEmployee } from './store.js';

/**
 * Directory sync from Keycloak (reference IdP).
 *
 * Configuration (env):
 * - KEYCLOAK_BASE_URL       e.g. http://localhost:8080
 * - KEYCLOAK_REALM          realm containing your users/groups (default: itnotice)
 * - KEYCLOAK_SYNC_CLIENT_ID     service-account client id (default: itnotice-sync)
 * - KEYCLOAK_SYNC_CLIENT_SECRET service-account client secret
 * - DIRECTORY_SYNC_INTERVAL_MINUTES  0 disables the interval (default: 60)
 *
 * The sync client needs realm-management roles: view-users, query-groups.
 * Employee phone numbers are read from the "phoneNumber" user attribute.
 */

const baseUrl = () => (process.env.KEYCLOAK_BASE_URL || '').replace(/\/$/, '');
const realm = () => process.env.KEYCLOAK_REALM || 'itnotice';

export function syncConfigured(): boolean {
  return Boolean(baseUrl() && process.env.KEYCLOAK_SYNC_CLIENT_SECRET);
}

async function getAdminToken(): Promise<string> {
  const response = await fetch(`${baseUrl()}/realms/${realm()}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.KEYCLOAK_SYNC_CLIENT_ID || 'itnotice-sync',
      client_secret: process.env.KEYCLOAK_SYNC_CLIENT_SECRET || '',
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Keycloak token request failed: ${response.status}`);
  }
  const data: any = await response.json();
  return data.access_token;
}

async function adminGet(token: string, path: string): Promise<any> {
  const response = await fetch(`${baseUrl()}/admin/realms/${realm()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Keycloak admin API ${path} failed: ${response.status}`);
  }
  return response.json();
}

export interface SyncResult {
  audiences: number;
  employees: number;
}

export async function runDirectorySync(): Promise<SyncResult> {
  if (!syncConfigured()) {
    throw new Error('Directory sync is not configured. Set KEYCLOAK_BASE_URL and KEYCLOAK_SYNC_CLIENT_SECRET.');
  }

  const token = await getAdminToken();

  const groups: Array<{ id: string; name: string }> = await adminGet(token, '/groups?max=500');
  for (const group of groups) {
    await upsertAudience(group.id, group.name, 'department');
  }

  const users: Array<any> = await adminGet(token, '/users?max=2000&enabled=true');
  let employeeCount = 0;

  for (const user of users) {
    if (!user.id || !user.username) continue;
    await upsertEmployee({
      id: user.id,
      username: user.username,
      displayName:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
      email: user.email || undefined,
      phone: user.attributes?.phoneNumber?.[0] || undefined,
    });

    const memberships: Array<{ id: string }> = await adminGet(token, `/users/${user.id}/groups?max=100`);
    await setEmployeeAudiences(
      user.id,
      memberships.map((group) => group.id),
    );
    employeeCount += 1;
  }

  return { audiences: groups.length, employees: employeeCount };
}

export function startSyncInterval(): void {
  const minutes = Number(process.env.DIRECTORY_SYNC_INTERVAL_MINUTES ?? 60);
  if (!syncConfigured() || !minutes) {
    console.log('[sync] directory sync interval disabled');
    return;
  }

  const run = () =>
    runDirectorySync()
      .then((result) => console.log(`[sync] synced ${result.employees} employees, ${result.audiences} audiences`))
      .catch((error) => console.error('[sync] directory sync failed', error?.message || error));

  void run();
  setInterval(run, minutes * 60_000);
}

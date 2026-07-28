import { getJSON, setJSON } from "./redis";

export async function bumpUsage(key) {
  const n = (await getJSON(key, 0)) || 0;
  await setJSON(key, n + 1);
}

export async function touchLastActive(user) {
  await setJSON(`lastActive:${user}`, new Date().toISOString());
}

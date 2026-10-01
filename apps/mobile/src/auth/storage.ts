import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const CHUNK = 1800;

async function webGet(key: string): Promise<string | null> {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key);
}

async function webSet(key: string, value: string): Promise<void> {
  localStorage.setItem(key, value);
}

async function webRemove(key: string): Promise<void> {
  localStorage.removeItem(key);
}

/** Session storage. Native values are split so they fit SecureStore's size limit. */
export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return webGet(key);
    const countRaw = await SecureStore.getItemAsync(`${key}.n`);
    if (!countRaw) return SecureStore.getItemAsync(key);
    const count = Number(countRaw);
    let value = "";
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(`${key}.${index}`);
      if (part == null) return null;
      value += part;
    }
    return value;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      await webSet(key, value);
      return;
    }
    await authStorage.removeItem(key);
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const count = Math.ceil(value.length / CHUNK);
    await SecureStore.setItemAsync(`${key}.n`, String(count));
    for (let index = 0; index < count; index += 1) {
      await SecureStore.setItemAsync(`${key}.${index}`, value.slice(index * CHUNK, (index + 1) * CHUNK));
    }
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      await webRemove(key);
      return;
    }
    const countRaw = await SecureStore.getItemAsync(`${key}.n`);
    if (countRaw) {
      const count = Number(countRaw);
      for (let index = 0; index < count; index += 1) {
        await SecureStore.deleteItemAsync(`${key}.${index}`);
      }
      await SecureStore.deleteItemAsync(`${key}.n`);
    }
    await SecureStore.deleteItemAsync(key);
  },
};

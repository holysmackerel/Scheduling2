import { supabase } from "./supabase";

const TABLE_NAME = "app_state";
const ROW_ID = "main";

export async function loadInitialData<T>(storeKey: string, seedData: () => T): Promise<T> {
  const localRaw = localStorage.getItem(storeKey);
  const localData = parseJson<T>(localRaw);

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("payload")
        .eq("id", ROW_ID)
        .maybeSingle();

      if (!error && data?.payload) {
        localStorage.setItem(storeKey, JSON.stringify(data.payload));
        return data.payload as T;
      }
    } catch (error) {
      console.warn("Supabase load failed. Falling back to local data.", error);
    }
  }

  if (localData) {
    return localData;
  }

  const seeded = seedData();
  localStorage.setItem(storeKey, JSON.stringify(seeded));
  return seeded;
}

export async function persistData<T>(storeKey: string, payload: T) {
  localStorage.setItem(storeKey, JSON.stringify(payload));

  if (!supabase) return;

  const { error } = await supabase
    .from(TABLE_NAME)
    .upsert({ id: ROW_ID, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) {
    console.warn("Supabase save failed. Local data is still saved.", error);
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// lib/user.ts

const USER_ID_KEY = "atomforge_user_id";

export function getUserId(): string {
  if (typeof window === "undefined") {
    throw new Error("getUserId() can only be called in the browser.");
  }

  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}
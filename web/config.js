// Fill in SUPABASE_URL and SUPABASE_ANON_KEY from Supabase > Project Settings > API.
// The anon key is meant to be public: the database's access rules are what protect the game.
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
export const VAPID_PUBLIC_KEY = 'BAOMU69cDpXXI0RZl3fTA4hkgIZgztF6BXOoWHXo4A48LT7nubbHVOqq6UfkOzLm28ViX16ZQI6osf_FhVGCjwQ';
// Players log in with a username; behind the scenes it's <username>@<this domain>.
// Must match the emails you gave the players in Supabase > Authentication > Users.
export const USERNAME_DOMAIN = 'YOUR-DOMAIN';

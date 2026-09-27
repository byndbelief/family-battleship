// Fill in SUPABASE_URL and SUPABASE_ANON_KEY from Supabase > Project Settings > API.
// The anon key is meant to be public: the database's access rules are what protect the game.
export const SUPABASE_URL = 'https://okywhdfmdpdvrfhbkyeo.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9reXdoZGZtZHBkdnJmaGJreWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0Nzc1OTQsImV4cCI6MjEwNjA1MzU5NH0.cJHfp_0pnAz9HpeX7e5UoGJ_K5rU6eSe1sajcktf8fs';
export const VAPID_PUBLIC_KEY = 'BAOMU69cDpXXI0RZl3fTA4hkgIZgztF6BXOoWHXo4A48LT7nubbHVOqq6UfkOzLm28ViX16ZQI6osf_FhVGCjwQ';
// Players log in with a username; behind the scenes it's <username>@<this domain>.
// Must match the emails you gave the players in Supabase > Authentication > Users.
export const USERNAME_DOMAIN = 'thegame.com';

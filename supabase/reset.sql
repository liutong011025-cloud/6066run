-- Clears leaderboard and all run history.
truncate table public.runs restart identity cascade;
truncate table public.players restart identity cascade;

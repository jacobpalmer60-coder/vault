/* Rate Trades: where shared votes are stored (Supabase, free tier). Paste your
   project's URL and its public "anon" key here (Supabase dashboard -> Project
   Settings -> API). The anon key is meant to be public: the database only lets
   it add a vote and read vote counts (see supabase/rate-trades.sql). Leave both
   empty and the page still works, saving votes on each device only. */
window.RATE_CONFIG = {
  supabaseUrl: '',
  anonKey: ''
};

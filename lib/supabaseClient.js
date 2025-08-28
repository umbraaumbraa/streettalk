import { createClient } from '@supabase/supabase-js';

// replace these with your Supabase project URL and anon key
const SUPABASE_URL = 'https://silselfpaujvgnhvkbql.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpbHNlbGZwYXVqdmduaHZrYnFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNzQ0NDQsImV4cCI6MjA3MTk1MDQ0NH0.YHSEzVFKq7vV49Kd3wH-115AVfj4e61VZO3zhWtYxFA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

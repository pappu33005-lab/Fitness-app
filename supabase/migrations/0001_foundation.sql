-- Authenticated health data. Guest data stays on the device until an account claims it.
-- The service role bypasses RLS, so Edge Functions that read health data must use the user JWT.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  age_years integer,
  sex text check (sex in ('female', 'male', 'unspecified')),
  height_cm numeric,
  weight_kg numeric,
  fitness_level text,
  activity_level text,
  goal text,
  unit_system text not null default 'metric',
  workout_preference text,
  dietary text[] not null default '{}',
  sleep_target_minutes integer,
  hydration_target_ml integer,
  step_goal integer,
  timezone text not null default 'UTC',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.health_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  metric text not null,
  value numeric not null,
  unit text not null,
  recorded_at timestamptz not null,
  timezone text not null,
  source text not null,
  source_record_id text,
  created_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (user_id, source, metric, source_record_id)
);

create table public.nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  day date not null,
  timezone text not null,
  meal text not null,
  food_name text not null,
  source text not null,
  source_id text,
  servings numeric not null,
  kcal numeric not null,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  sugar_g numeric,
  sodium_mg numeric,
  notes text,
  logged_at timestamptz not null,
  unique (user_id, client_id)
);

create table public.hydration_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  day date not null,
  timezone text not null,
  ml integer not null,
  logged_at timestamptz not null,
  unique (user_id, client_id)
);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  timezone text not null,
  unique (user_id, client_id)
);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_client_id text not null,
  client_id text not null,
  exercise_id text not null,
  exercise_name text not null,
  set_index integer not null,
  reps integer,
  weight_kg numeric,
  completed_at timestamptz not null,
  unique (user_id, client_id)
);

create table public.sleep_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  day date not null,
  timezone text not null,
  asleep_start timestamptz not null,
  asleep_end timestamptz not null,
  source text not null,
  unique (user_id, client_id)
);

create table public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  kind text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  timezone text not null,
  distance_meters numeric not null,
  moving_seconds integer not null,
  unique (user_id, client_id)
);

create table public.activity_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_client_id text not null,
  client_id text not null,
  latitude double precision not null,
  longitude double precision not null,
  altitude_meters double precision,
  recorded_at timestamptz not null,
  unique (user_id, client_id)
);

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (name in (
    'onboarding_started', 'onboarding_completed', 'workout_started', 'workout_completed',
    'meal_logged', 'food_scanned', 'sleep_recorded', 'ai_interaction', 'goal_completed',
    'health_connection', 'wearable_connection'
  )),
  occurred_at timestamptz not null,
  subject_id text
);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.wearable_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('healthkit', 'health_connect', 'apple_watch', 'fitbit', 'garmin')),
  status text not null,
  detail text,
  unique (user_id, provider)
);

create index health_samples_user_time_idx on public.health_samples (user_id, recorded_at);
create index nutrition_logs_user_day_idx on public.nutrition_logs (user_id, day);
create index activity_points_session_idx on public.activity_points (user_id, session_client_id);

alter table public.profiles enable row level security;
alter table public.health_samples enable row level security;
alter table public.nutrition_logs enable row level security;
alter table public.hydration_logs enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_sets enable row level security;
alter table public.sleep_sessions enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.activity_points enable row level security;
alter table public.product_events enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.wearable_connections enable row level security;

create policy profiles_own on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy health_samples_own on public.health_samples for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy nutrition_logs_own on public.nutrition_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy hydration_logs_own on public.hydration_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workout_sessions_own on public.workout_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workout_sets_own on public.workout_sets for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sleep_sessions_own on public.sleep_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy activity_sessions_own on public.activity_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy activity_points_own on public.activity_points for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy product_events_own on public.product_events for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_conversations_own on public.ai_conversations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_messages_own on public.ai_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wearable_connections_own on public.wearable_connections for all using (user_id = auth.uid()) with check (user_id = auth.uid());

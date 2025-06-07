-- Создание таблицы для проектов
create table if not exists projects (
    id uuid default gen_random_uuid() primary key,
    name text not null,
    color text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Создание таблицы для событий календаря
create table if not exists calendar_events (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    description text,
    date date not null,
    start_time time not null,
    end_time time not null,
    project_id uuid references projects(id) on delete set null,
    type text not null check (type in ('event', 'project')),
    is_live boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Создание таблицы для деталей дня
create table if not exists day_details (
    date date primary key,
    calories jsonb default '{"morning": 0, "afternoon": 0, "evening": 0}'::jsonb,
    comment text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Создание таблицы для отслеживания синхронизации
create table if not exists sync_status (
    id uuid default gen_random_uuid() primary key,
    last_sync timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Создание индексов
create index if not exists idx_calendar_events_date on calendar_events(date);
create index if not exists idx_calendar_events_project_id on calendar_events(project_id);
create index if not exists idx_calendar_events_type on calendar_events(type);
create index if not exists idx_calendar_events_updated_at on calendar_events(updated_at);

-- Создание триггеров для автоматического обновления updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$ language plpgsql;

create trigger update_projects_updated_at
    before update on projects
    for each row
    execute function update_updated_at_column();

create trigger update_calendar_events_updated_at
    before update on calendar_events
    for each row
    execute function update_updated_at_column();

create trigger update_day_details_updated_at
    before update on day_details
    for each row
    execute function update_updated_at_column();

-- Создание политик безопасности (RLS)
alter table projects enable row level security;
alter table calendar_events enable row level security;
alter table day_details enable row level security;
alter table sync_status enable row level security;

-- Политики для проектов
create policy "Проекты доступны всем аутентифицированным пользователям"
    on projects for all
    to authenticated
    using (true);

-- Политики для событий календаря
create policy "События доступны всем аутентифицированным пользователям"
    on calendar_events for all
    to authenticated
    using (true);

-- Политики для деталей дня
create policy "Детали дня доступны всем аутентифицированным пользователям"
    on day_details for all
    to authenticated
    using (true);

-- Политики для статуса синхронизации
create policy "Статус синхронизации доступен всем аутентифицированным пользователям"
    on sync_status for all
    to authenticated
    using (true); 
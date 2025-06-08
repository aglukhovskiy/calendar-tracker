// Получите эти значения из настроек вашего проекта в Supabase
// Project Settings -> API -> Project URL и anon/public key
export const SUPABASE_URL = process.env.SUPABASE_URL
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

// Имена таблиц в базе данных
export const TABLES = {
    EVENTS: 'events',
    POMODORO_SESSIONS: 'pomodoro_sessions',
    PROJECTS: 'projects'
} 
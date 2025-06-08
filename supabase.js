import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

// Проверяем наличие необходимых переменных
console.log('=== Supabase Configuration ===');
console.log('SUPABASE_URL:', SUPABASE_URL ? `${SUPABASE_URL.substring(0, 10)}...` : 'undefined');
console.log('SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? `${SUPABASE_ANON_KEY.substring(0, 10)}...` : 'undefined');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Ошибка: SUPABASE_URL и SUPABASE_ANON_KEY должны быть определены');
    throw new Error('SUPABASE_URL и SUPABASE_ANON_KEY должны быть определены');
}

// Initialize Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
console.log('Supabase client initialized');

// Database operations
export const db = {
    // Events
    async getEvents(date) {
        console.log('Fetching events for date:', date);
        try {
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('date', date)
            if (error) {
                console.error('Error fetching events:', error);
                throw error;
            }
            console.log('Events fetched successfully:', data);
            return data;
        } catch (error) {
            console.error('Exception in getEvents:', error);
            throw error;
        }
    },

    async createEvent(event) {
        const { data, error } = await supabase
            .from('events')
            .insert([event])
            .select()
        if (error) throw error
        return data[0]
    },

    async updateEvent(id, updates) {
        const { data, error } = await supabase
            .from('events')
            .update(updates)
            .eq('id', id)
            .select()
        if (error) throw error
        return data[0]
    },

    async deleteEvent(id) {
        const { error } = await supabase
            .from('events')
            .delete()
            .eq('id', id)
        if (error) throw error
    },

    // Pomodoro sessions
    async getPomodoroSessions(date) {
        const { data, error } = await supabase
            .from('pomodoro_sessions')
            .select('*')
            .eq('date', date)
        if (error) throw error
        return data
    },

    async createPomodoroSession(session) {
        const { data, error } = await supabase
            .from('pomodoro_sessions')
            .insert([session])
            .select()
        if (error) throw error
        return data[0]
    },

    // Projects
    async getProjects() {
        console.log('Fetching projects...');
        try {
            const { data, error } = await supabase
                .from('projects')
                .select('*')
            if (error) {
                console.error('Error fetching projects:', error);
                throw error;
            }
            console.log('Projects fetched successfully:', data);
            return data;
        } catch (error) {
            console.error('Exception in getProjects:', error);
            throw error;
        }
    },

    async createProject(project) {
        const { data, error } = await supabase
            .from('projects')
            .insert([project])
            .select()
        if (error) throw error
        return data[0]
    },

    async deleteProject(projectId) {
        const { error } = await supabase
            .from('projects')
            .delete()
            .eq('id', projectId)
        if (error) throw error
        return true
    },

    // Calendar events
    async getCalendarEvents(startDate, endDate) {
        console.log('Fetching calendar events from', startDate, 'to', endDate);
        try {
            const { data, error } = await supabase
                .from('calendar_events')
                .select('*')
                .gte('date', startDate)
                .lte('date', endDate)
                .order('date')
                .order('start_time')
            if (error) {
                console.error('Error fetching calendar events:', error);
                throw error;
            }
            console.log('Calendar events fetched successfully:', data);
            return data || [];
        } catch (error) {
            console.error('Exception in getCalendarEvents:', error);
            throw error;
        }
    },

    async createCalendarEvent(eventData) {
        const { data, error } = await supabase
            .from('calendar_events')
            .insert([eventData])
            .select()
            .single()
        if (error) throw error
        return data
    },

    async updateCalendarEvent(eventId, eventData) {
        const { data, error } = await supabase
            .from('calendar_events')
            .update(eventData)
            .eq('id', eventId)
            .select()
            .single()
        if (error) throw error
        return data
    },

    async deleteCalendarEvent(eventId) {
        const { error } = await supabase
            .from('calendar_events')
            .delete()
            .eq('id', eventId)
        if (error) throw error
        return true
    },

    // Day details
    async getDayDetails(date) {
        const { data, error } = await supabase
            .from('day_details')
            .select('*')
            .eq('date', date)
            .single()
        if (error && error.code !== 'PGRST116') throw error
        return data || null
    },

    async upsertDayDetails(dayData) {
        const { data, error } = await supabase
            .from('day_details')
            .upsert([dayData], { onConflict: 'date' })
            .select()
            .single()
        if (error) throw error
        return data
    },

    // Sync
    async syncCalendarData() {
        const { data: syncData } = await supabase
            .from('sync_status')
            .select('last_sync')
            .single()

        const lastSync = syncData?.last_sync || new Date(0).toISOString()

        const { data: events, error: eventsError } = await supabase
            .from('calendar_events')
            .select('*')
            .gt('updated_at', lastSync)

        if (eventsError) throw eventsError

        await supabase
            .from('sync_status')
            .upsert([{ last_sync: new Date().toISOString() }])

        return events || []
    },

    // Export/Import
    async exportCalendarData(startDate, endDate) {
        const [events, dayDetails] = await Promise.all([
            this.getCalendarEvents(startDate, endDate),
            supabase
                .from('day_details')
                .select('*')
                .gte('date', startDate)
                .lte('date', endDate)
                .then(({ data }) => data || [])
        ])

        return {
            events,
            dayDetails
        }
    },

    async importCalendarData(data) {
        const { events, dayDetails } = data

        if (events && events.length > 0) {
            const { error: eventsError } = await supabase
                .from('calendar_events')
                .upsert(events, { onConflict: 'id' })
            
            if (eventsError) throw eventsError
        }

        if (dayDetails && dayDetails.length > 0) {
            const { error: detailsError } = await supabase
                .from('day_details')
                .upsert(dayDetails, { onConflict: 'date' })
            
            if (detailsError) throw detailsError
        }

        return true
    }
} 
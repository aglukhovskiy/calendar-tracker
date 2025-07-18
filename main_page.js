import { storage } from './storage';
import { elements, initializeElements } from './dom-elements';
import { supabase } from './supabase';
import { db } from './supabase';

// === GLOBALS ===
let projects = [];
let calendarEvents = [];
let selectedProjectId = null;
let currentWeekStart = getStartOfWeek(new Date());
let stopwatch = {
    isRunning: false,
    startTime: null,
    elapsedTime: 0,
    liveEventId: null
};
let stopwatchInterval = null;
let currentDate = new Date();
let editingEventId = null;

let allDayDetailsData = {}; // Кеш для данных о калориях и комментариях
const ALL_DAY_DETAILS_KEY = 'allDayDetails';
let dayDetailsManager = null; // Экземпляр класса DayDetails

const HOUR_CELL_HEIGHT = 48; // Высота ячейки часа в пикселях (должна совпадать с CSS)

// ==== UTILS ====
function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        console.error('[FORMAT DATE] Некорректная дата:', date);
        return '';
    }
    
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    return `${year}-${month}-${day}`;
}

function pad(x) { return x.toString().padStart(2, '0'); }

function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const result = new Date(d.getFullYear(), d.getMonth(), diff);
    return result;
}

function getWeekDates(startDate) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        dates.push(date);
    }
    return dates;
}

function minutesSinceMidnight(dateObj) {
    return dateObj.getHours() * 60 + dateObj.getMinutes();
}

function localIso(dt) {
    return dt.toISOString().slice(0, 19).replace('T', ' ');
}

function localToDate(str) {
    return new Date(str.replace(' ', 'T'));
}

function getLocalDateString(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
        console.error('[getLocalDateString] Передана некорректная дата:', dateObj);
        return null;
    }
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ==== MODAL FUNCTIONS ====
function closeDayDetailModal() {
    console.log('[CLOSE DAY DETAIL] Закрытие модального окна деталей дня');
    const modal = document.getElementById('day-detail-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Функция для правильной обработки строк CSV
function parseCSVRow(text) {
    if (!text) return [];

    const result = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const char = text[i];

        if (char === '"') {
            // Проверка на экранированную кавычку
            if (inQuotes && i+1 < text.length && text[i+1] === '"') {
                cell += '"';
                i += 2; // Пропускаем следующую кавычку
                continue;
            }

            inQuotes = !inQuotes;
            i++;
            continue;
        }

        if (char === ';' && !inQuotes) {
            result.push(cell);
            cell = '';
            i++;
            continue;
        }

        cell += char;
        i++;
    }

    result.push(cell); // Добавляем последнюю ячейку
    return result.map(c => c.trim());
}

async function exportToCSV() {
    console.log("Export process started");
    const result = await storage.get([
        'calendarEvents', 'projects', ALL_DAY_DETAILS_KEY
    ]);
    console.log("Data fetched from storage for export");
    
    const localCalendarEvents = result.calendarEvents || [];
    const localProjects = result.projects || [];
    const localAllDayDetails = result[ALL_DAY_DETAILS_KEY] || {};
    
    const projectMap = {};
    localProjects.forEach(project => {
        projectMap[project.id] = project.name;
    });

    let allDatesSet = new Set(localCalendarEvents.map(ev => ev.date));
    Object.keys(localAllDayDetails).forEach(dateStr => allDatesSet.add(dateStr));
    let uniqueDates = Array.from(allDatesSet).sort();

    let header = [
        "Дата", "День недели",
        "Калории утром", "Калории днем", "Калории вечером", "Комментарий дня",
        "События", "Проекты"
    ];

    let csvContent = '\uFEFF' + header.join(';') + '\n';

    uniqueDates.forEach(dateStr => {
        let dateObj = new Date(dateStr + "T00:00:00");
        let dayOfWeek = dateObj.toLocaleDateString('ru-RU', { weekday: "short" });
        const details = localAllDayDetails[dateStr] || {};
        const cals = details.calories || {};

        const events = localCalendarEvents
            .filter(ev => ev.date === dateStr && ev.type === 'event')
            .map(ev => {
                const start = new Date(ev.startTime);
                const end = new Date(ev.endTime);
                const durationMinutes = Math.round((end - start) / 60000);
                return {
                    title: ev.title,
                    description: ev.description || '',
                    startTime: ev.startTime,
                    endTime: ev.endTime,
                    duration: durationMinutes,
                    projectName: ev.projectId ? (projectMap[ev.projectId] || 'Unknown Project') : null,
                    type: ev.type
                };
            });

        const projectsData = localCalendarEvents // Renamed to avoid conflict with global `projects`
            .filter(ev => ev.date === dateStr && ev.type === 'project')
            .map(ev => {
                const start = new Date(ev.startTime);
                const end = new Date(ev.endTime);
                const durationMinutes = Math.round((end - start) / 60000);
                return {
                    title: ev.title,
                    description: ev.description || '',
                    startTime: ev.startTime,
                    endTime: ev.endTime,
                    duration: durationMinutes,
                    projectName: ev.projectId ? (projectMap[ev.projectId] || 'Unknown Project') : null,
                    type: ev.type
                };
            });

        const eventsJsonString = events.length > 0 ?
            JSON.stringify(events).replace(/"/g, '""') :
            '[]';
        const projectsJsonString = projectsData.length > 0 ? // Use projectsData
            JSON.stringify(projectsData).replace(/"/g, '""') :
            '[]';

        let row = [
            `"${dateStr}"`,
            `"${dayOfWeek}"`,
            `"${cals.morning || 0}"`,
            `"${cals.afternoon || 0}"`,
            `"${cals.evening || 0}"`,
            `"${(details.comment || '').replace(/"/g, '""')}"`,
            `"${eventsJsonString}"`,
            `"${projectsJsonString}"`
        ];
        csvContent += row.join(';') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calendar_data_${formatDate(new Date()).replace(/-/g, '')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log("Export completed");
}
function updateCurrentTimeIndicator() {
    const now = new Date();
    const currentDay = now.getDay(); // 0 for Sunday, 1 for Monday, etc.
    const dayIndex = (currentDay === 0) ? 6 : currentDay - 1; // Adjust to 0 for Monday, 6 for Sunday if week starts Monday

    const existingIndicator = document.querySelector('.current-time-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Ищем колонку для текущего дня
    const dayColumn = document.querySelector(`.day-column:nth-child(${dayIndex + 1})`);
    if (!dayColumn) return; // Если колонка не найдена, просто выходим из функции

    const indicator = document.createElement('div');
    indicator.className = 'current-time-indicator';

    const totalMinutesInDay = now.getHours() * 60 + now.getMinutes();
    const columnHeight = dayColumn.offsetHeight;
    const position = (totalMinutesInDay / (24 * 60)) * columnHeight;

    indicator.style.top = `${position}px`;
    dayColumn.appendChild(indicator);
}


// --- ИСПРАВЛЕННАЯ ФУНКЦИЯ ---

function updateStopwatchUI() {
    // ИЗМЕНЕНО: ID 'stopwatch-display' заменен на 'sidebar-timer-display'
    const stopwatchDisplay = document.getElementById('sidebar-timer-display'); 
    
    if (!stopwatchDisplay) {
        // Добавим лог ошибки, чтобы в будущем было легче отлаживать
        console.error("Элемент для отображения таймера ('sidebar-timer-display') не найден!");
        return;
    }

    let displayTime = '00:00:00';
    if (stopwatch.isRunning && stopwatch.startTime) {
        const now = Date.now();
        const elapsed = now - stopwatch.startTime;
        const totalSeconds = Math.floor(elapsed / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        displayTime = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    stopwatchDisplay.textContent = displayTime;

    // Этот блок кода ищет элемент для отображения имени проекта.
    // В вашем HTML его нет, но если добавите, он будет работать.
    const stopwatchProjectDisplay = document.getElementById('stopwatch-project-name');
    if (stopwatchProjectDisplay) {
        if (stopwatch.isRunning && stopwatch.projectId) {
            const project = projects.find(p => p.id === stopwatch.projectId);
            stopwatchProjectDisplay.textContent = project ? `Проект: ${project.name}` : "Проект не выбран";
        } else {
            stopwatchProjectDisplay.textContent = "";
        }
    }
}


function persistStopwatchState() {
    storage.set({ stopwatch: {
        isRunning: stopwatch.isRunning,
        startTime: stopwatch.startTime,
        projectId: stopwatch.projectId,
        liveEventId: stopwatch.liveEventId,
        // ДОБАВЛЕНО: сохраняем флаги синхронизации
        isSyncedWithSupabase: stopwatch.isSyncedWithSupabase,
        lastSupabaseSync: stopwatch.lastSupabaseSync
    }});
}
// ==== Функции для работы со секундомером ====

// Константы для синхронизации
const SYNC_RETRY_DELAY = 2000; // 2 секунды
const MAX_SYNC_RETRIES = 3;

// Функция для синхронизации с Supabase с повторными попытками
async function syncWithSupabaseWithRetry(operation, retryCount = 0) {
    try {
        return await operation();
    } catch (error) {
        console.error(`[SYNC] Ошибка синхронизации (попытка ${retryCount + 1}/${MAX_SYNC_RETRIES}):`, error);
        
        if (retryCount < MAX_SYNC_RETRIES - 1) {
            console.log(`[SYNC] Повторная попытка через ${SYNC_RETRY_DELAY}мс...`);
            await new Promise(resolve => setTimeout(resolve, SYNC_RETRY_DELAY));
            return syncWithSupabaseWithRetry(operation, retryCount + 1);
        }
        
        throw error;
    }
}

// Обновляем функцию syncLiveCalendarEvent
async function syncLiveCalendarEvent() {
    if (!stopwatch.isRunning || !stopwatch.liveEventId) {
        console.log('[SYNC LIVE EVENT] Секундомер не запущен или нет активного события');
        return;
    }

    const now = Date.now();
    if (now - stopwatch.lastSupabaseSync < 5000) {
        return;
    }

    console.log('[SYNC LIVE EVENT] Начало синхронизации с Supabase');
    
    try {
        const elapsedMinutes = Math.floor((now - stopwatch.startTime) / 60000);
        const event = calendarEvents.find(e => e.id === stopwatch.liveEventId);
        
        if (!event) {
            console.error('[SYNC LIVE EVENT] Событие не найдено в локальном состоянии');
            return;
        }

        await syncWithSupabaseWithRetry(async () => {
            const { data, error } = await supabase
                .from('calendar_events')
                .update({
                    duration: elapsedMinutes,
                    updated_at: new Date().toISOString()
                })
                .eq('id', stopwatch.liveEventId);

            if (error) throw error;
            
            stopwatch.lastSupabaseSync = now;
            persistStopwatchState();
            
            console.log('[SYNC LIVE EVENT] Синхронизация успешна');
        });
    } catch (error) {
        console.error('[SYNC LIVE EVENT] Ошибка синхронизации:', error);
        // Не выбрасываем ошибку, чтобы не прерывать работу секундомера
    }
}

// Обновляем функцию createCalendarEvent
async function createCalendarEvent(eventData) {
    console.log('[CREATE EVENT] Создание события:', eventData);
    
    try {
        // Проверяем обязательные поля
        if (!eventData.title || !eventData.date || !eventData.start_time || !eventData.end_time) {
            throw new Error('Не все обязательные поля заполнены');
        }

        // Проверяем пересечение с существующими событиями
        const hasOverlap = calendarEvents.some(event => 
            event.date === eventData.date && 
            event.start_time < eventData.end_time && 
            event.end_time > eventData.start_time
        );

        if (hasOverlap) {
            throw new Error('Событие пересекается с существующим');
        }

        // Создаем событие в базе данных
        const newEvent = await syncWithSupabaseWithRetry(async () => {
            const { data, error } = await supabase
                .from('calendar_events')
                .insert([{
                    ...eventData,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) throw error;
            return data;
        });

        // Добавляем в локальное состояние
        calendarEvents.push(newEvent);
        
        // Перерисовываем события
        renderEvents(calendarEvents, currentWeekStart);
        
        console.log('[CREATE EVENT] Событие успешно создано');
        return newEvent;
    } catch (error) {
        console.error('[CREATE EVENT] Ошибка при создании события:', error);
        throw error;
    }
}

// Обновляем функцию updateCalendarEvent
async function updateCalendarEvent(eventId, updates) {
    console.log('[UPDATE EVENT] Обновление события:', { eventId, updates });
    
    try {
        // Проверяем существование события
        const eventIndex = calendarEvents.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            throw new Error('Событие не найдено');
        }

        // Проверяем пересечение с другими событиями
        if (updates.start_time || updates.end_time) {
            const event = calendarEvents[eventIndex];
            const startTime = updates.start_time || event.start_time;
            const endTime = updates.end_time || event.end_time;
            
            const hasOverlap = calendarEvents.some((e, index) => 
                index !== eventIndex &&
                e.date === event.date && 
                e.start_time < endTime && 
                e.end_time > startTime
            );

            if (hasOverlap) {
                throw new Error('Обновление создаст пересечение с существующим событием');
            }
        }

        // Обновляем в базе данных
        const updatedEvent = await syncWithSupabaseWithRetry(async () => {
            const { data, error } = await supabase
                .from('calendar_events')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', eventId)
                .select()
                .single();

            if (error) throw error;
            return data;
        });

        // Обновляем локальное состояние
        calendarEvents[eventIndex] = updatedEvent;
        
        // Перерисовываем события
        renderEvents(calendarEvents, currentWeekStart);
        
        console.log('[UPDATE EVENT] Событие успешно обновлено');
        return updatedEvent;
    } catch (error) {
        console.error('[UPDATE EVENT] Ошибка при обновлении события:', error);
        throw error;
    }
}

// Обновляем функцию deleteCalendarEvent
async function deleteCalendarEvent(eventId) {
    console.log('[DELETE EVENT] Удаление события:', eventId);
    
    try {
        // Проверяем существование события
        const eventIndex = calendarEvents.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            throw new Error('Событие не найдено');
        }

        // Удаляем из базы данных
        await syncWithSupabaseWithRetry(async () => {
            const { error } = await supabase
                .from('calendar_events')
                .delete()
                .eq('id', eventId);

            if (error) throw error;
        });

        // Удаляем из локального состояния
        calendarEvents.splice(eventIndex, 1);
        
        // Перерисовываем события
        renderEvents(calendarEvents, currentWeekStart);
        
        console.log('[DELETE EVENT] Событие успешно удалено');
    } catch (error) {
        console.error('[DELETE EVENT] Ошибка при удалении события:', error);
        throw error;
    }
}

// Вспомогательная функция для форматирования длительности
function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
}

function handleLiveEventExpansion() {
    const liveEventElement = document.querySelector('.calendar-event.live');
    if (liveEventElement) {
        liveEventElement.classList.add('expanded'); // Or some other visual cue
        // Potentially scroll to it if it's off-screen
        // liveEventElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ДОБАВЛЕНО: Общая функция для тика таймера
function tick() {
    updateStopwatchUI();      // Обновляет текстовое поле таймера
    syncLiveCalendarEvent();  // Обновляет визуальное событие в календаре
}

function startStopwatch() {
    if (!stopwatch.isRunning) {
        stopwatch.isRunning = true;
        stopwatch.startTime = Date.now();
        stopwatch.projectId = selectedProjectId;
        stopwatch.liveEventId = `local-live-${stopwatch.startTime}`;
        stopwatch.isSyncedWithSupabase = false;
        stopwatch.lastSupabaseSync = 0;

        persistStopwatchState();
        
        // ИЗМЕНЕНО: Вызываем tick() сразу и ставим его в интервал
        tick();
        stopwatchInterval = setInterval(tick, 1000);

        // Visually update stopwatch controls
        const startBtn = document.getElementById('start-pomodoro');
        const pauseBtn = document.getElementById('pause-pomodoro');
        if (startBtn) startBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = false;
    }
}

async function stopOrPauseStopwatch(isStoppingCompletely = true) {
    if (!stopwatch.isRunning) return;

    // Сначала останавливаем интервал, чтобы избежать гонки состояний
    clearInterval(stopwatchInterval);
    stopwatchInterval = null;
    stopwatch.isRunning = false;

    const finalEndTime = new Date();
    const finalEventTitle = (projects.find(p => p.id === stopwatch.projectId)?.name || 'Работа') + ` (${formatDuration(finalEndTime - stopwatch.startTime)})`;

    // Финализация события в БД
    if (stopwatch.isSyncedWithSupabase && stopwatch.liveEventId) {
        console.log(`[FINALIZE EVENT] Финализация события ${stopwatch.liveEventId} в Supabase...`);
        try {
            // Проверяем, не было ли событие уже финализировано
            const existingEvent = await db.getCalendarEvent(stopwatch.liveEventId);
            if (existingEvent && existingEvent.is_live) {
                await db.updateCalendarEvent(stopwatch.liveEventId, {
                    title: finalEventTitle,
                    end_time: localIso(finalEndTime).split('T')[1],
                    is_live: false
                });
                console.log(`[FINALIZE EVENT] Событие успешно финализировано.`);
            } else {
                console.log(`[FINALIZE EVENT] Событие уже было финализировано ранее.`);
            }
        } catch (error) {
            console.error(`[FINALIZE EVENT] Ошибка при финализации события:`, error);
            // Продолжаем выполнение, так как локальное состояние уже обновлено
        }
    } else if (stopwatch.startTime) {
        // Если событие не успело синхронизироваться, создаем его как финализированное
        console.log("[FINALIZE EVENT] Создание финализированного события, которое не успело синхронизироваться...");
        try {
            await db.createCalendarEvent({
                title: finalEventTitle,
                date: getLocalDateString(new Date(stopwatch.startTime)),
                start_time: localIso(new Date(stopwatch.startTime)).split('T')[1],
                end_time: localIso(finalEndTime).split('T')[1],
                project_id: stopwatch.projectId,
                type: stopwatch.projectId ? 'project' : 'event',
                is_live: false
            });
            console.log(`[FINALIZE EVENT] Несинхронизированное событие создано как финализированное.`);
        } catch (error) {
            console.error(`[FINALIZE EVENT] Ошибка при создании финализированного события:`, error);
        }
    }

    // Обновляем локальные данные
    const event = calendarEvents.find(ev => ev.id === stopwatch.liveEventId);
    if (event) {
        event.endTime = localIso(finalEndTime);
        event.is_live = false;
        event.isLive = false;
        renderEvents();
    }

    // Сбрасываем состояние секундомера, если это полный стоп
    if (isStoppingCompletely) {
        stopwatch.startTime = null;
        stopwatch.projectId = null;
        stopwatch.liveEventId = null;
        stopwatch.isSyncedWithSupabase = false;
        stopwatch.lastSupabaseSync = 0;
    }

    // Обновляем UI после всех операций
    updateStopwatchUI();
    persistStopwatchState();

    // Обновляем кнопки
    const startBtn = document.getElementById('start-pomodoro');
    const pauseBtn = document.getElementById('pause-pomodoro');
    if (startBtn) startBtn.disabled = stopwatch.isRunning;
    if (pauseBtn) pauseBtn.disabled = !stopwatch.isRunning;
}

// Старые функции теперь просто вызывают новую общую функцию
function pauseStopwatch() {
    stopOrPauseStopwatch(false); // Пауза - это не полный стоп
}

function stopStopwatch() {
    stopOrPauseStopwatch(true); // Стоп - это полный сброс
}


async function loadStopwatchState() {
    const result = await storage.get('stopwatch');
    if (result.stopwatch) {
        stopwatch = result.stopwatch;
        if (stopwatch.isRunning) {
            startStopwatch();
        } else {
            updateStopwatchUI();
        }
    }
}

async function loadProjects() {
    const result = await storage.get('projects');
    projects = result.projects || [];
    console.log('Projects loaded:', projects);
    renderProjectSelectAndList();
}

async function loadEvents(forWeekStart) {
    try {
        const weekStart = forWeekStart || getStartOfWeek(new Date());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        console.log('[LOAD EVENTS] Загрузка событий с', weekStart.toISOString(), 'по', weekEnd.toISOString());
        
        const events = await db.getCalendarEvents(weekStart, weekEnd);
        console.log('[LOAD EVENTS] Загружено событий:', events.length);
        
        renderEvents(events, weekStart);
    } catch (error) {
        console.error('[LOAD EVENTS] Ошибка загрузки событий:', error);
    }
}

function renderEvents(events, weekStart) {
    const weekDates = getWeekDates(weekStart);
    console.log('[RENDER EVENTS] Даты недели:', weekDates.map(d => formatDate(d)));
    
    // Очищаем существующие события
    document.querySelectorAll('.calendar-event').forEach(el => el.remove());
    
    events.forEach(event => {
        try {
            const eventDate = new Date(event.date);
            if (isNaN(eventDate.getTime())) {
                console.error('[RENDER EVENTS] Некорректная дата события:', event.date);
                return;
            }

            const weekDate = weekDates.find(d => {
                const d1 = new Date(d);
                const d2 = new Date(eventDate);
                return d1.getFullYear() === d2.getFullYear() && 
                       d1.getMonth() === d2.getMonth() && 
                       d1.getDate() === d2.getDate();
            });
            
            if (!weekDate) {
                console.log('[RENDER EVENTS] Событие не входит в текущую неделю:', {
                    event: event,
                    eventDate: formatDate(eventDate),
                    weekDates: weekDates.map(d => formatDate(d))
                });
                return;
            }

            const startTime = new Date(`2000-01-01T${event.start_time}`);
            const endTime = new Date(`2000-01-01T${event.end_time}`);
            
            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                console.error('[RENDER EVENTS] Некорректное время события:', {
                    start: event.start_time,
                    end: event.end_time
                });
                return;
            }
            
            const startHour = startTime.getHours();
            const startMinute = startTime.getMinutes();
            const endHour = endTime.getHours();
            const endMinute = endTime.getMinutes();
            
            const startMinutes = startHour * 60 + startMinute;
            const endMinutes = endHour * 60 + endMinute;
            const durationMinutes = endMinutes - startMinutes;
            
            const topPosition = startMinutes * (HOUR_CELL_HEIGHT / 60);
            const height = Math.max(durationMinutes * (HOUR_CELL_HEIGHT / 60), 20);
            
            console.log('[RENDER EVENTS] Создание события:', {
                id: event.id,
                date: formatDate(eventDate),
                start: event.start_time,
                end: event.end_time,
                top: topPosition,
                height: height
            });

            const eventElement = document.createElement('div');
            eventElement.className = 'calendar-event';
            eventElement.style.top = `${topPosition}px`;
            eventElement.style.height = `${height}px`;
            eventElement.dataset.id = event.id;
            eventElement.dataset.instanceId = event.instance_id;
            eventElement.dataset.projectId = event.project_id;
            eventElement.dataset.completed = event.completed;
            
            // Форматируем время для отображения в HH:mm
            const startTimeStr = `${pad(startHour)}:${pad(startMinute)}`;
            const endTimeStr = `${pad(endHour)}:${pad(endMinute)}`;
            
            eventElement.innerHTML = `
                <div class="event-content">
                    <div class="event-time">${startTimeStr} - ${endTimeStr}</div>
                    <div class="event-title">${event.title || 'Без названия'}</div>
                </div>
            `;

            // Добавляем обработчик клика для события
            eventElement.addEventListener('click', (e) => {
                e.stopPropagation(); // Останавливаем всплытие, чтобы не сработал клик на ячейке часа
                console.log(`Клик по событию ID: ${event.id}`);
                openEventModal(event.id); // Открываем модалку для редактирования
            });
            
            const dayColumn = document.querySelector(`.day-column[data-date="${formatDate(eventDate)}"]`);
            if (dayColumn) {
                dayColumn.appendChild(eventElement);
                console.log('[RENDER EVENTS] Событие добавлено в DOM:', event.id);
            } else {
                console.error('[RENDER EVENTS] Не найден столбец для даты:', formatDate(eventDate));
            }
        } catch (error) {
            console.error('[RENDER EVENTS] Ошибка при рендеринге события:', error);
        }
    });
}

// ==== Инициализация ====
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM полностью загружен, начинаем инициализацию...");
    
    // Инициализируем DOM элементы
    if (!initializeElements()) {
        console.error('Не удалось инициализировать все необходимые DOM элементы');
        return;
    }
    
    // Инициализируем обработчики событий
    initializeEventHandlers();
    
    // Загружаем начальные данные
    await initialLoad();
    
    // Остальной код инициализации...
});


// UI / DOM
const timerDisplay = document.getElementById('sidebar-timer-display');
const startBtn = document.getElementById('start-pomodoro');
const pauseBtn = document.getElementById('pause-pomodoro');
const stopBtn = document.getElementById('stop-pomodoro'); // Assuming this is the general stop button
const selectProjectSel = document.getElementById('select-project');
const addProjectBtn = document.getElementById('add-project');
const newProjectNameInput = document.getElementById('project-name');
const projectsListContainer = document.getElementById('projects-list');
const projectStats = document.getElementById('project-stats');
const exportCsvBtn = document.getElementById('export-csv');
const importCsvBtn = document.getElementById('import-csv');
const prevWeekBtn = document.getElementById('prev-week');
const nextWeekBtn = document.getElementById('next-week');
const currentWeekBtn = document.getElementById('current-week');
const openDatePickerBtn = document.getElementById('open-date-picker');
const daysHeaderContainer = document.querySelector('.days-header');
const weekGridContainer = document.querySelector('.week-grid'); // Corrected selector
const timeSlotsContainer = document.querySelector('.time-slots');
const eventModal = document.getElementById('event-modal');
const eventForm = document.getElementById('event-form');
const eventTitleInput = document.getElementById('event-title');
const eventDateInput = document.getElementById('event-date');
const eventStartInput = document.getElementById('event-start');
const eventEndInput = document.getElementById('event-end');
const eventDescriptionInput = document.getElementById('event-description');
const saveEventBtn = document.getElementById('save-event');
const deleteEventBtn = document.getElementById('delete-event');
const cancelEventBtn = document.getElementById('cancel-event');

const datePickerModal = document.getElementById('date-picker-modal');
const calendarGridDom = document.getElementById('calendar-grid');
const monthTitle = document.getElementById('month-title');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');
const datePickerSelectBtn = document.getElementById('date-picker-select');
const datePickerTodayBtn = document.getElementById('date-picker-today');
const datePickerCancelBtn = document.getElementById('date-picker-cancel');
const weekdayHeader = document.getElementById('weekday-header');
const dayDetailModal = document.getElementById('day-detail-modal');
const dayDetailModalDateDisplay = document.getElementById('day-detail-modal-date-display');
const caloriesMorningInput = document.getElementById('calories-morning');
const caloriesAfternoonInput = document.getElementById('calories-afternoon');
const caloriesEveningInput = document.getElementById('calories-evening');
const commentInput = document.getElementById('day-comment');
const saveDayDetailsBtn = document.getElementById('day-detail-save');
const cancelDayDetailsBtn = document.getElementById('day-detail-cancel');
const totalCaloriesValueSpan = document.getElementById('total-calories-value');
const regularEventDetails = document.getElementById('regular-event-details');
const regularEventModalTitle = document.getElementById('regular-event-modal-title');
const regularEventModalStatus = document.getElementById('regular-event-modal-status');
const toggleCompletionBtn = document.getElementById('toggle-completion-btn');
const regularEventCancelBtn = document.getElementById('regular-event-cancel-btn'); // Добавили кнопку отмены



if (regularEventCancelBtn) {
    regularEventCancelBtn.addEventListener('click', closeEventModal);
}

// Event listeners for stopwatch buttons (example)
if (startBtn) {
    startBtn.addEventListener('click', () => {
        // If stopwatch was paused, this might be "Resume"
        // For simplicity, just calling startStopwatch which handles "is not running"
        startStopwatch();
    });
}
if (pauseBtn) {
    pauseBtn.addEventListener('click', pauseStopwatch);
}
if (stopBtn) { // General stop button for the feature / or a dedicated one
    stopBtn.addEventListener('click', () => {
       // Ask user if they want to save the timed event
        if (stopwatch.isRunning || stopwatch.startTimestamp) { // If there's something to stop
            if (confirm("Остановить таймер? Затраченное время будет сохранено как событие. Отмена - продолжить отсчет.")) {
                stopStopwatch(true); // Stop and save
            }
            // else: do nothing, timer continues or remains paused
        }
    });
}


// УНИВЕРСАЛЬНЫЕ ОБРАБОТЧИКИ ЗАКРЫТИЯ МОДАЛЬНЫХ ОКОН
document.querySelectorAll('.modal .close-modal, .date-picker-modal .close-modal, .day-detail-modal .close-modal').forEach(btn => {
    btn.addEventListener('click', function() {
        const modalToClose = this.closest('.modal, .date-picker-modal, .day-detail-modal');
        if (modalToClose) {
            modalToClose.style.display = "none";
            if (modalToClose.id === 'event-modal') {
                closeEventModal();
            }
            if (modalToClose.id === 'day-detail-modal' && dayDetailsManager) {
                dayDetailsManager.closeDayDetailModal();
            }
        }
    });
});

window.addEventListener('click', function(event) {
    [eventModal, datePickerModal, dayDetailModal].forEach(modal => {
        if (modal && event.target === modal) {
            modal.style.display = "none";
            if (modal.id === 'event-modal') closeEventModal();
            if (modal.id === 'day-detail-modal') closeDayDetailModal(); // Используем новую функцию закрытия
        }
    });
});

if (openDatePickerBtn) {
    openDatePickerBtn.addEventListener('click', () => {
       openDatePicker();
    });
}

// ---- Секция с РАНЕЕ УДАЛЕННЫМИ УТИЛИТАМИ ----
// Функции formatDate, pad, getStartOfWeek и т.д. УЖЕ БЫЛИ ОБЪЯВЛЕНЫ В НАЧАЛЕ ФАЙЛА.
// Повторное объявление здесь было бы ошибкой. Я УДАЛИЛ ЭТОТ ДУБЛИРУЮЩИЙ БЛОК.
// function formatDate(date) { ... } // УДАЛЕНО
// function pad(x) { ... } // УДАЛЕНО
// и так далее...
// ---------------------------------------------


// ==== ПРОЕКТЫ ====
function renderProjectSelectAndList() {
    if (selectProjectSel) {
        const currentSelectedVal = selectProjectSel.value;
        selectProjectSel.innerHTML = `<option value="">-- Проект --</option>`;
        projects.forEach(prj => {
            const opt = document.createElement('option');
            opt.value = prj.id;
            opt.textContent = prj.name;
            // if (prj.color) opt.style.backgroundColor = prj.color; // Optional: color code options
            selectProjectSel.appendChild(opt);
        });
        
        // Restore selection
        if (projects.find(p => p.id === currentSelectedVal)) {
            selectProjectSel.value = currentSelectedVal;
        } else if (selectedProjectId && projects.find(p => p.id === selectedProjectId)) {
            selectProjectSel.value = selectedProjectId;
        } else {
             selectProjectSel.value = ""; // Default if no valid selection
        }
    }
    renderProjectsList(); // Call to render the separate list of projects
}

function renderProjectsList() {
    if (projectsListContainer) {
        projectsListContainer.innerHTML = '';
        if (projects.length === 0) {
            projectsListContainer.innerHTML = '<div>Нет проектов. Добавьте новый.</div>';
            return;
        }
        projects.forEach(project => {
            const div = document.createElement('div');
            div.className = 'project-item';
            // div.style.borderLeft = `5px solid ${project.color || '#ccc'}`; // Example with project color
            div.innerHTML = `
                <span class="project-name-display">${project.name}</span>
                <button class="delete-project delete-project-btn" data-id="${project.id}" title="Удалить проект">🗑️</button>
            `;
            // Add click listener to project item to select it (optional UX)
            div.querySelector('.project-name-display').addEventListener('click', () => {
                if (selectProjectSel) selectProjectSel.value = project.id;
                selectedProjectId = project.id;
                storage.set({selectedProjectId});
                renderProjectStats(project.id);
                // Highlight selected project in the list (add a class)
            });
            projectsListContainer.appendChild(div);
        });
    }
}

if (selectProjectSel) {
    selectProjectSel.addEventListener('change', e => {
        const newProjectId = selectProjectSel.value || null; // Handle empty selection

        if (stopwatch.isRunning && stopwatch.projectId && stopwatch.projectId !== newProjectId) {
            if (confirm("Секундомер активен для другого проекта. Остановить текущий отсчет и переключить проект? (ОК для остановки и смены, Отмена для сохранения текущей работы)")) {
                stopStopwatch(true); // Stop and save current tracked time
                selectedProjectId = newProjectId;
                storage.set({selectedProjectId});
                // Update stopwatch's project context IF user decides to immediately start for new project
                // stopwatch.projectId = newProjectId; // This would happen on next startStopwatch()
            } else {
                selectProjectSel.value = stopwatch.projectId; // Revert dropdown to active project
                return; // Don't change selectedProjectId
            }
        } else {
            selectedProjectId = newProjectId;
            storage.set({selectedProjectId});
        }
        renderProjectStats(selectedProjectId);
        updateStopwatchUI(); // To update project name in stopwatch display if any
    });
}

if (projectsListContainer) {
    projectsListContainer.addEventListener('click', async (e) => { // Make async for storage operations
        if (e.target.classList.contains('delete-project-btn')) {
            const id = e.target.getAttribute("data-id");
            const projectToDelete = projects.find(p => p.id === id);
            if (projectToDelete && confirm(`Вы уверены, что хотите удалить проект "${projectToDelete.name}"? Связанные события останутся, но потеряют привязку к проекту.`)) {
                
                // Update projects array
                projects = projects.filter(p => p.id !== id);
                
                // Update calendarEvents: remove projectId from associated events
                calendarEvents.forEach(ev => {
                    if (ev.projectId === id) {
                        ev.projectId = null;
                    }
                });

                if (selectedProjectId === id) {
                    selectedProjectId = null;
                    if (selectProjectSel) selectProjectSel.value = '';
                }
                if (stopwatch.isRunning && stopwatch.projectId === id) {
                    // Decide: stop timer or let it continue without project?
                    if(confirm("Удаляемый проект используется активным таймером. Остановить таймер? (ОК - остановить, Отмена - таймер продолжит без проекта)")) {
                        stopStopwatch(true); // Stop and save
                    } else {
                        stopwatch.projectId = null; // Timer continues without project
                        persistStopwatchState();
                        updateStopwatchUI();
                    }
                }
                
                // Save changes to storage
                storage.set({projects, calendarEvents, selectedProjectId});
                // No need to call render functions if onChanged listener is robust
                // renderProjectSelectAndList();
                // renderProjectStats(selectedProjectId);
                // renderEvents(); // if project colors/styling depends on project existence
            }
        }
    });
}

if (addProjectBtn && newProjectNameInput) {
    addProjectBtn.addEventListener('click', async () => {
        console.log('[ADD PROJECT BTN CLICKED]'); // <--- ДОБАВЬТЕ ЭТОТ ЛОГ
        const projectName = newProjectNameInput.value.trim();
        if (!projectName) {
            alert("Имя проекта не может быть пустым.");
            return;
        }

        // Проверка на существующий проект (по локально загруженным данным)
        if (projects.find(p => p.name.toLowerCase() === projectName.toLowerCase())) {
            alert("Проект с таким именем уже существует (локально). Попробуйте обновить список или выберите другое имя.");
            // Можно добавить здесь await loadProjects(); для актуализации, если есть сомнения
            return;
        }

        console.log(`[ADD PROJECT] Попытка создать проект: "${projectName}"`);
        try {
            // Объект для отправки в Supabase. ID будет сгенерирован Supabase.
            // `color` и другие поля должны соответствовать вашей схеме таблицы 'projects' в Supabase.
            const projectDataForSupabase = {
                name: projectName,
                color: getRandomColor() // Убедитесь, что в таблице есть поле 'color' или удалите это
                // user_id: supabase.auth.user()?.id // Если проекты привязаны к пользователю
            };

            // Вызываем метод из вашего db объекта
            const createdProject = await db.createProject(projectDataForSupabase);

            if (!createdProject || !createdProject.id) {
                alert("Не удалось создать проект. Сервер не вернул данные о созданном проекте.");
                console.error('[ADD PROJECT] db.createProject не вернул ожидаемый объект:', createdProject);
                return;
            }

            console.log('[ADD PROJECT] Проект успешно создан в Supabase:', createdProject);

            // 1. Обновляем локальный список проектов, перезагрузив их все из Supabase.
            // Это самый надежный способ получить актуальное состояние, включая новый проект.
            await loadProjects(); // Эта функция должна обновить глобальную переменную `projects`

            // 2. Очищаем поле ввода
            newProjectNameInput.value = '';

            // 3. Автоматически выбираем новый проект в UI
            selectedProjectId = createdProject.id;
            if (selectProjectSel) {
                selectProjectSel.value = createdProject.id; // Это может не сработать сразу, если renderProjectSelectAndList() еще не вызван с обновленными projects
            }
            // Сохраняем ID выбранного проекта в локальное хранилище,
            // чтобы и другие части приложения знали о выборе, и чтобы сработал onChanged.
            storage.set({ selectedProjectId: createdProject.id });

            // 4. Обновляем UI явно (можно положиться на onChanged, но явный вызов надежнее для немедленного эффекта)
            // renderProjectSelectAndList(); // Вызовется через onChanged или если loadProjects не обновляет UI
            // renderProjectsList();         // Аналогично
            // renderProjectStats(createdProject.id); // Обновить статистику для нового проекта

            // Если loadProjects() не вызывает рендеры и не сохраняет `projects` в storage (чей onChanged бы вызвал рендеры),
            // то нужно вызвать их здесь:
            // renderProjectSelectAndList(); // Должен быть вызван так как projects обновился
            // renderProjectsList();
            // renderProjectStats(selectedProjectId);


        } catch (error) {
            alert(`Ошибка при создании проекта: ${error.message}`);
            console.error('[ADD PROJECT] Ошибка при взаимодействии с Supabase:', error);
        }
    });
}

function getRandomColor() { // Helper for new projects
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function formatTime(totalMinutes) {
    if (!totalMinutes || totalMinutes <= 0) return '0 мин';
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    let result = [];
    if (hours > 0) {
        result.push(`${hours} ч`);
    }
    if (minutes > 0) {
        result.push(`${minutes} мин`);
    }
    
    return result.join(' ');
}

function renderProjectStats(projId) {
    if (!projectStats) return;
    
    projectStats.innerHTML = ''; // Очищаем контейнер
    
    if (!projId) {
        projectStats.textContent = 'Проект не выбран.';
        return;
    }
    
    const project = projects.find(p => p.id === projId);
    if (!project) {
        projectStats.textContent = 'Проект не найден.';
        return;
    }

    const todayStr = formatDate(new Date());

    // Общая функция-сумматор для подсчета минут
    const calculateMinutes = (events) => {
        return events.reduce((total, ev) => {
            try {
                // Пропускаем "живые" события, так как их длительность еще не финальная
                if (ev.is_live) return total;
                
                const startTime = localToDate(ev.startTime);
                const endTime = localToDate(ev.endTime);

                if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
                    const duration = Math.max(0, Math.round((endTime - startTime) / 60000));
                    return total + duration;
                }
                return total;
            } catch (e) {
                console.warn("Could not calculate duration for event:", ev);
                return total;
            }
        }, 0);
    };

    // 1. Считаем время за СЕГОДНЯ
    const todaysEvents = calendarEvents.filter(ev => ev.projectId === projId && ev.date === todayStr);
    const todayTotalMinutes = calculateMinutes(todaysEvents);

    // 2. Считаем время за ТЕКУЩУЮ ОТОБРАЖАЕМУЮ НЕДЕЛЮ
    // calendarEvents уже содержит только события текущей недели
    const weeklyEvents = calendarEvents.filter(ev => ev.projectId === projId);
    const weekTotalMinutes = calculateMinutes(weeklyEvents);
    
    // Формируем и выводим HTML
    projectStats.innerHTML = `
        <div class="stats-header"><b>${project.name}</b></div>
        <div class="stats-item">
            <span>За сегодня:</span>
            <span>${formatTime(todayTotalMinutes)}</span>
        </div>
        <div class="stats-item">
            <span>За эту неделю:</span>
            <span>${formatTime(weekTotalMinutes)}</span>
        </div>
    `;
}

function renderDaysHeader(weekStart) {
    console.log('[RENDER DAYS HEADER] Начало выполнения функции');
    console.log('[RENDER DAYS HEADER] weekStart:', weekStart);
    
    const daysHeader = document.querySelector('.days-header');
    console.log('[RENDER DAYS HEADER] daysHeader элемент:', daysHeader);
    if (!daysHeader) {
        console.error('[RENDER DAYS HEADER] Элемент .days-header не найден!');
        return;
    }
    
    daysHeader.innerHTML = '';
    
    const weekDates = getWeekDates(weekStart);
    console.log('[RENDER DAYS HEADER] Даты недели:', weekDates);
    
    weekDates.forEach((date, index) => {
        console.log(`[RENDER DAYS HEADER] Обработка дня ${index + 1}:`, date);
        
        const dayColumn = document.createElement('div');
        dayColumn.className = 'day-column';
        
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        
        const dayName = document.createElement('div');
        dayName.className = 'day-name';
        dayName.textContent = date.toLocaleDateString('ru-RU', { weekday: 'short' });
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = date.getDate();
        
        dayHeader.addEventListener('click', () => {
            console.log('[DAY HEADER] Клик по заголовку дня:', formatDate(date));
            openDayDetailModal(formatDate(date));
        });
        
        dayHeader.appendChild(dayName);
        dayHeader.appendChild(dayNumber);
        dayColumn.appendChild(dayHeader);
        daysHeader.appendChild(dayColumn);
    });
    
    console.log('[RENDER DAYS HEADER] Завершение функции');
}

// ==== Календарь — выбор даты (Date Picker) ====
let selectedPickerYear = currentDate.getFullYear();
let selectedPickerMonth = currentDate.getMonth();

function openDatePicker() {
    selectedPickerYear = currentDate.getFullYear();
    selectedPickerMonth = currentDate.getMonth();
    if(datePickerModal) {
        datePickerModal.style.display = 'block';
        renderDatePickerCalendar(selectedPickerYear, selectedPickerMonth);
    } else {
        console.error("Date picker modal not found");
    }
}

if(datePickerCancelBtn) datePickerCancelBtn.addEventListener('click', ()=> { if(datePickerModal) datePickerModal.style.display='none'});

if(datePickerTodayBtn) {
    datePickerTodayBtn.addEventListener('click', ()=>{
        const today = new Date();
        currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // Normalized to start of day
        currentWeekStart = getStartOfWeek(currentDate);
        renderDaysHeader(currentWeekStart);
        renderWeekGrid(currentWeekStart);
        if(datePickerModal) datePickerModal.style.display='none';
    });
}
if(datePickerSelectBtn) {
    datePickerSelectBtn.addEventListener('click', ()=>{
        const sel = calendarGridDom ? calendarGridDom.querySelector('.calendar-day.selected') : null;
        if(sel && sel.dataset.date) {
            const datestr = sel.dataset.date;
            currentDate = localToDate(datestr + "T00:00:00"); // Use localToDate or new Date()
            currentWeekStart = getStartOfWeek(currentDate);
            renderDaysHeader(currentWeekStart);
            renderWeekGrid(currentWeekStart);
            if(datePickerModal) datePickerModal.style.display='none';
        } else {
            alert("Дата не выбрана.");
        }
    });
}
if(prevMonthBtn) {
    prevMonthBtn.addEventListener('click', ()=>{
        selectedPickerMonth--;
        if(selectedPickerMonth<0) {selectedPickerMonth=11;selectedPickerYear--;}
        renderDatePickerCalendar(selectedPickerYear, selectedPickerMonth);
    });
}
if(nextMonthBtn) {
    nextMonthBtn.addEventListener('click', ()=>{
        selectedPickerMonth++;
        if(selectedPickerMonth>11) {selectedPickerMonth=0;selectedPickerYear++;}
        renderDatePickerCalendar(selectedPickerYear, selectedPickerMonth);
    });
}

function renderDatePickerCalendar(year, month) {
    if (!monthTitle || !calendarGridDom || !weekdayHeader) {
        console.error("Date picker elements missing for rendering.");
        return;
    }
    monthTitle.textContent = `${new Date(year, month).toLocaleString('ru-RU', { month: 'long' })} ${year}`;
    calendarGridDom.innerHTML = '';

    if (weekdayHeader.children.length === 0) {
         ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d=>weekdayHeader.innerHTML += `<span>${d}</span>`);
    }

    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const todayStr = formatDate(new Date());
    const currentSelectedDateStr = formatDate(currentDate);


    let dayElementsHtml = "";
    let firstDayOfWeek = (firstOfMonth.getDay() + 6) % 7;
    for (let i = 0; i < firstDayOfWeek; i++) {
        dayElementsHtml += `<div class="calendar-day other-month"></div>`;
    }

    for (let day = 1; day <= lastOfMonth.getDate(); day++) {
        let dt = new Date(year, month, day);
        let dateStr = formatDate(dt);
        let classes = 'calendar-day';
        if (dateStr === currentSelectedDateStr) classes += ' selected';
        if (dateStr === todayStr) classes += ' today-picker';
         dayElementsHtml += `<div class="${classes}" data-date="${dateStr}">${day}</div>`;
    }
    calendarGridDom.innerHTML = dayElementsHtml;

    calendarGridDom.querySelectorAll('.calendar-day:not(.other-month)').forEach(dayDiv => {
        dayDiv.addEventListener('click', function() {
            calendarGridDom.querySelectorAll('.calendar-day.selected').forEach(el => el.classList.remove('selected'));
            this.classList.add('selected');
        });
    });
}


// ==== Неделя влево/вправо ====
if(prevWeekBtn) prevWeekBtn.addEventListener('click', ()=>{
    currentDate.setDate(currentDate.getDate()-7);
    currentWeekStart = getStartOfWeek(currentDate); // Recalculate to be sure
    renderDaysHeader(currentWeekStart); renderWeekGrid(currentWeekStart);
});
if(nextWeekBtn) nextWeekBtn.addEventListener('click', ()=>{
    currentDate.setDate(currentDate.getDate()+7);
    currentWeekStart = getStartOfWeek(currentDate);
    renderDaysHeader(currentWeekStart); renderWeekGrid(currentWeekStart);
});
if(currentWeekBtn) currentWeekBtn.addEventListener('click', ()=>{
    currentDate = new Date();
    currentDate.setHours(0,0,0,0); // Normalize
    currentWeekStart = getStartOfWeek(currentDate);
    renderDaysHeader(currentWeekStart); renderWeekGrid(currentWeekStart);
});

// ==== Экспорт / Импорт ====
if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportToCSV);
}

if (importCsvBtn) {
    importCsvBtn.addEventListener('click', async () => {
        let fileInp = document.createElement('input');
        fileInp.type = 'file';
        fileInp.accept = '.csv';
        fileInp.style.display = 'none';

        fileInp.addEventListener('change', function() {
            if (!fileInp.files || fileInp.files.length === 0) {
                if (fileInp.parentNode) fileInp.remove();
                return;
            }

            const selectedFile = fileInp.files[0];
            let reader = new FileReader();

            reader.onload = async function(e) {
                try {
                    let txt = e.target.result;
                    console.log(`Import: Reading file ${selectedFile.name} (${txt.length} bytes)`);

                    if (txt.charCodeAt(0) === 0xFEFF) {
                        txt = txt.slice(1);
                    }

                    const lines = txt.split(/\r\n|\n|\r/).filter(line => line.trim());
                    if (lines.length < 2) {
                        alert("Файл пуст или содержит только заголовки без данных.");
                        if (fileInp.parentNode) fileInp.remove();
                        return;
                    }

                    const headerLine = lines[0];
                    let headerFields;
                    try {
                        // Use parseCSVRow for header as well, in case header fields are quoted
                        headerFields = parseCSVRow(headerLine);
                    } catch (error) {
                        alert("Ошибка при разборе заголовка CSV: " + error.message);
                        if (fileInp.parentNode) fileInp.remove();
                        return;
                    }

                    const headerMap = {};
                    headerFields.forEach((field, index) => {
                        headerMap[field.trim().replace(/^"|"$/g, '')] = index; // Ensure field names are clean
                    });

                    if (!('Дата' in headerMap)) {
                        alert("В CSV файле отсутствует обязательная колонка 'Дата'.");
                        if (fileInp.parentNode) fileInp.remove();
                        return;
                    }

                    console.log("Import: Found headers:", headerMap);

                    let importedCalendarEvents = [];
                    let importedAllDayDetails = {};

                    storage.get(['projects'], (storageData) => {
                        const existingProjects = storageData.projects || [];
                        const projectNameToId = {};
                        existingProjects.forEach(project => {
                            projectNameToId[project.name.toLowerCase()] = project.id; // Use toLowerCase for matching
                        });

                        let newProjects = [];

                        for (let i = 1; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (!line) continue;

                            // Use robust parseCSVRow for data lines
                            const fields = parseCSVRow(line);

                            if (fields.length < Object.keys(headerMap).length && fields.length < headerFields.length) { // check against original header length too
                                console.warn(`Import: Line ${i+1} has ${fields.length} fields, expected at least ${Math.min(Object.keys(headerMap).length, headerFields.length)}. Line: "${line}"`);
                                continue;
                            }

                            const dateStr = fields[headerMap['Дата']];
                            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                                console.warn(`Import: Invalid date format in line ${i+1}:`, dateStr);
                                continue;
                            }

                            importedAllDayDetails[dateStr] = {
                                calories: {
                                    morning: parseInt(fields[headerMap['Калории утром']] || '0') || 0,
                                    afternoon: parseInt(fields[headerMap['Калории днем']] || '0') || 0,
                                    evening: parseInt(fields[headerMap['Калории вечером']] || '0') || 0
                                },
                                comment: fields[headerMap['Комментарий дня']] || ''
                            };

                            const safeParseJSON = (jsonString) => {
                                if (!jsonString || jsonString === '[]' || jsonString.trim() === '') return [];
                                try {
                                    let cleaned = jsonString;
                                    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                                        cleaned = cleaned.substring(1, cleaned.length - 1);
                                    }
                                    cleaned = cleaned.replace(/""/g, '"');
                                    return JSON.parse(cleaned);
                                } catch (error) {
                                    console.error("Error parsing JSON:", error, "Original String:", jsonString);
                                    return [];
                                }
                            };

                            const processJsonField = (jsonFieldKey, type) => {
                                if (jsonFieldKey in headerMap) {
                                    const jsonString = fields[headerMap[jsonFieldKey]];
                                    const items = safeParseJSON(jsonString);

                                    if (Array.isArray(items)) {
                                        items.forEach(item => {
                                            if (!item || !item.startTime || !item.endTime) { // Basic validation
                                                console.warn(`Import: Skipping invalid item in ${jsonFieldKey} for date ${dateStr}:`, item);
                                                return;
                                            }
                                            
                                            let projectId = null;
                                            if (item.projectName && item.projectName.toLowerCase() !== 'null' && item.projectName.toLowerCase() !== 'undefined') {
                                                const projNameLower = item.projectName.toLowerCase();
                                                if (projectNameToId[projNameLower]) {
                                                    projectId = projectNameToId[projNameLower];
                                                } else {
                                                    const existingNew = newProjects.find(p => p.name.toLowerCase() === projNameLower);
                                                    if (existingNew) {
                                                        projectId = existingNew.id;
                                                    } else {
                                                        const newPrjId = `prj-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                                                        const newProj = { id: newPrjId, name: item.projectName, color: getRandomColor() };
                                                        newProjects.push(newProj);
                                                        projectNameToId[projNameLower] = newPrjId; // Add to map for subsequent items
                                                        projectId = newPrjId;
                                                    }
                                                }
                                            }

                                            importedCalendarEvents.push({
                                                id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                                                title: item.title || 'Без названия',
                                                description: item.description || '',
                                                date: dateStr,
                                                startTime: item.startTime,
                                                endTime: item.endTime,
                                                projectId: projectId,
                                                type: type,
                                                isLive: false
                                            });
                                        });
                                    }
                                }
                            };

                            processJsonField('События', 'event');
                            processJsonField('Проекты', 'project');
                        }

                        console.log(`Import: Processed ${importedCalendarEvents.length} events and ${Object.keys(importedAllDayDetails).length} days data.`);
                        console.log(`Import: Found ${newProjects.length} new projects to add:`, newProjects.map(p=>p.name));

                        const updatedProjects = [...existingProjects];
                        newProjects.forEach(newProject => {
                            if (!updatedProjects.some(p => p.id === newProject.id || p.name.toLowerCase() === newProject.name.toLowerCase())) {
                                updatedProjects.push(newProject);
                            }
                        });

                        // Ask for confirmation before wiping and importing
                        if (!confirm(`Готовы импортировать ${importedCalendarEvents.length} событий, данные для ${Object.keys(importedAllDayDetails).length} дней и ${newProjects.length} новых проектов? Существующие данные календаря и дней будут ЗАМЕНЕНЫ.`)) {
                            console.log("Import cancelled by user.");
                            if (fileInp.parentNode) fileInp.remove();
                            return;
                        }


                        storage.remove(['calendarEvents', ALL_DAY_DETAILS_KEY], () => {
                            if (chrome.runtime.lastError) {
                                 console.error("Import: Error removing old data:", chrome.runtime.lastError);
                                 alert("Ошибка при удалении старых данных: " + chrome.runtime.lastError.message);
                                 if (fileInp.parentNode) fileInp.remove();
                                 return;
                            }
                            console.log("Import: Old calendar data removed");

                            storage.set({
                                calendarEvents: importedCalendarEvents,
                                [ALL_DAY_DETAILS_KEY]: importedAllDayDetails,
                                projects: updatedProjects // Save combined projects list
                            }, () => {
                                if (chrome.runtime.lastError) {
                                    console.error("Import: Error saving data:", chrome.runtime.lastError);
                                    alert("Ошибка при сохранении импортированных данных: " + chrome.runtime.lastError.message);
                                } else {
                                    console.log("Import: Data saved successfully!");
                                    alert(`Импорт завершен. Импортировано ${importedCalendarEvents.length} событий, данные для ${Object.keys(importedAllDayDetails).length} дней. Добавлено/обновлено проектов. Страница будет перезагружена.`);
                                    window.location.reload();
                                }
                                if (fileInp.parentNode) fileInp.remove();
                            });
                        });
                    }); // end storage.get
                } catch (error) {
                    console.error("Error importing data:", error);
                    alert("Ошибка при импорте данных");
                }
            };

            reader.onerror = (event) => { // Correctly access error from event
                alert("Ошибка чтения файла: " + event.target.error);
                console.error("FileReader error:", event.target.error);
                if (fileInp.parentNode) fileInp.remove();
            };

            reader.readAsText(selectedFile, "UTF-8"); // Specify encoding

        }); // end fileInp.addEventListener('change')

        document.body.appendChild(fileInp); // Add to body to make it clickable in some browsers
        fileInp.click();
        // No need to remove immediately, change handler or new click will handle it
    }); // end importCsvBtn.addEventListener('click')
} // end if (importCsvBtn)

async function openEventModal(eventId = null, dateStr = null, hour = null) {
    console.log('[OPEN EVENT MODAL] Открытие модального окна:', { eventId, dateStr, hour });
    
    const modal = document.getElementById('event-modal');
    const titleInput = document.getElementById('event-title');
    const startTimeInput = document.getElementById('event-start');
    const endTimeInput = document.getElementById('event-end');
    const projectSelect = document.getElementById('select-project');
    const deleteButton = document.getElementById('delete-event');
    const saveButton = document.getElementById('save-event');
    
    if (!modal || !titleInput || !startTimeInput || !endTimeInput || !projectSelect || !deleteButton || !saveButton) {
        console.error('[OPEN EVENT MODAL] Не найдены необходимые элементы:', {
            modal: !!modal,
            titleInput: !!titleInput,
            startTimeInput: !!startTimeInput,
            endTimeInput: !!endTimeInput,
            projectSelect: !!projectSelect,
            deleteButton: !!deleteButton,
            saveButton: !!saveButton
        });
        return;
    }
    
    // Очищаем форму
    titleInput.value = '';
    startTimeInput.value = '';
    endTimeInput.value = '';
    projectSelect.value = '';
    
    // Активируем все поля
    titleInput.disabled = false;
    startTimeInput.disabled = false;
    endTimeInput.disabled = false;
    projectSelect.disabled = false;
    
    if (eventId) {
        // Редактирование существующего события
        console.log('[OPEN EVENT MODAL] Загрузка данных события:', eventId);
        
        // Получаем начало и конец текущей недели
        const weekStart = getStartOfWeek(new Date());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        // Загружаем события за всю неделю
        const events = await db.getCalendarEvents(weekStart, weekEnd);
        const event = events.find(e => e.id === eventId);
            
        if (!event) {
            console.error('[OPEN EVENT MODAL] Событие не найдено:', eventId);
            return;
        }
        
        console.log('[OPEN EVENT MODAL] Загруженные данные события:', event);
        
        titleInput.value = event.title || '';
        startTimeInput.value = event.start_time || '';
        endTimeInput.value = event.end_time || '';
        projectSelect.value = event.project_id || '';
        
        deleteButton.style.display = 'block';
        saveButton.textContent = 'Сохранить изменения';
        
        // Сохраняем ID события и дату для последующего сохранения
        modal.dataset.eventId = eventId;
        modal.dataset.eventDate = event.date;
    } else {
        // Создание нового события
        if (dateStr && hour !== null) {
            const startHour = Math.floor(hour);
            const startMinute = Math.round((hour - startHour) * 60);
            const endHour = startHour + 1;
            
            startTimeInput.value = `${pad(startHour)}:${pad(startMinute)}`;
            endTimeInput.value = `${pad(endHour)}:${pad(startMinute)}`;
        } else {
            // Если время не указано, устанавливаем текущее время
            const now = new Date();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            
            startTimeInput.value = `${pad(currentHour)}:${pad(currentMinute)}`;
            endTimeInput.value = `${pad(currentHour + 1)}:${pad(currentMinute)}`;
        }
        
        deleteButton.style.display = 'none';
        saveButton.textContent = 'Создать событие';
        delete modal.dataset.eventId;
        
        // Сохраняем дату для нового события
        modal.dataset.eventDate = dateStr || formatDate(new Date());
    }
    
    modal.style.display = 'block';
}


function closeEventModal() {
    if (eventModal) {
        eventModal.style.display = 'none';
    }
    editingEventId = null;
    
    // Очищаем обработчик, чтобы избежать случайных вызовов
    if (toggleCompletionBtn) {
        toggleCompletionBtn.onclick = null;
    }
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function saveEvent(eventData) {
    console.log('[SAVE EVENT] Сохранение события:', eventData);
    
    try {
        const modal = document.getElementById('event-modal');
        const eventId = modal.dataset.eventId;
        const eventDate = modal.dataset.eventDate;
        
        if (!eventDate) {
            throw new Error('Дата события не указана');
        }
        
        // Создаем объект только с нужными полями
        const eventDataToSave = {
            id: eventId || generateUUID(),
            title: eventData.title,
            description: eventData.description || '',
            date: eventDate,
            start_time: eventData.startTime.split('T')[1],
            end_time: eventData.endTime.split('T')[1],
            project_id: eventData.project_id || null,
            type: eventData.type || 'event',
            is_live: false
        };
        
        if (eventId) {
            // Обновление существующего события
            await db.updateCalendarEvent(eventId, eventDataToSave);
        } else {
            // Создание нового события
            await db.createCalendarEvent(eventDataToSave);
        }
        
        // Перезагружаем события и обновляем отображение
        const weekStart = getStartOfWeek(new Date());
        const events = await loadEvents(weekStart);
        renderEvents(events, weekStart);
        
        closeEventModal();
    } catch (error) {
        console.error('[SAVE EVENT] Ошибка при сохранении события:', error);
        alert('Ошибка при сохранении события: ' + error.message);
    }
}

async function deleteEvent(eventId) {
    const result = await storage.get('calendarEvents');
    const allEvents = result.calendarEvents || [];
    const updatedEvents = allEvents.filter(e => e.id !== eventId);
    await storage.set({ calendarEvents: updatedEvents });
    await loadEvents();
}

// Обновляем обработчик сохранения события
if (saveEventBtn) {
    saveEventBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        const title = eventTitleInput.value.trim();
        const date = eventDateInput.value;
        const startTimeString = eventStartInput.value;
        const endTimeString = eventEndInput.value;
        const description = eventDescriptionInput.value.trim();
        
        if (!title || !date || !startTimeString || !endTimeString) {
            alert("Пожалуйста, заполните название, дату и время начала/окончания.");
            return;
        }
        
        if (endTimeString <= startTimeString) {
            alert("Время окончания должно быть позже времени начала.");
            return;
        }
        
        // Получаем projectId из селекта в модальном окне, если он там есть
        // Или из глобального selectedProjectId, если это новое событие
        let finalProjectId = null;
        const eventProjectSelect = document.getElementById('event-modal-project-select');
        if (eventProjectSelect && eventProjectSelect.value) {
            finalProjectId = eventProjectSelect.value;
        } else if (!editingEventId && selectProjectSel && selectProjectSel.value) {
             finalProjectId = selectProjectSel.value;
        } else if (editingEventId) {
            const currentEvent = calendarEvents.find(ev => ev.id === editingEventId);
            if (currentEvent) finalProjectId = currentEvent.project_id;
        }

        const eventType = finalProjectId ? 'project' : 'event';

        const eventDataPayload = {
            id: editingEventId,
            title,
            description,
            date,
            startTime: `${date}T${startTimeString}`,
            endTime: `${date}T${endTimeString}`,
            project_id: finalProjectId,
            type: eventType,
            is_live: false
        };
        
        console.log("[SAVE EVENT] Собранный eventDataPayload:", eventDataPayload);
        await saveEvent(eventDataPayload);
        closeEventModal();
    });
}
// Обновляем обработчик удаления события
if (deleteEventBtn) {
    deleteEventBtn.addEventListener('click', async () => {
        if (editingEventId && confirm("Вы уверены, что хотите удалить это событие?")) {
            await deleteEvent(editingEventId);
            closeEventModal();
        }
    });
}

if (cancelEventBtn) {
    cancelEventBtn.addEventListener('click', closeEventModal);
}

// Placeholder for DayDetailsManager if you create it as a class
// class DayDetailsManager {
//     constructor() { /* ... */ }
//     openDayDetailModal(dateStr) { /* ... */ }
//     closeDayDetailModal() { /* ... */ }
//     saveDayDetails() { /* ... */ }
// }
// if (!dayDetailsManager) {
//    dayDetailsManager = new DayDetailsManager();
// }


// Обработчик для кнопки сохранения деталей дня
if (saveDayDetailsBtn) {
    saveDayDetailsBtn.addEventListener('click', async () => {
        const dateStr = dayDetailModalDateDisplay.textContent;
        if (!dateStr) {
            alert("Не удалось определить дату дня.");
            return;
        }

        const calories = {
            morning: parseInt(caloriesMorningInput.value) || 0,
            afternoon: parseInt(caloriesAfternoonInput.value) || 0,
            evening: parseInt(caloriesEveningInput.value) || 0,
        };
        const comment = commentInput.value.trim();

        const detailsToSave = {
            calories: calories,
            comment: comment
        };

        await saveDayDetails(dateStr, detailsToSave);
        // После сохранения, обновим локальный кэш allDayDetailsData и UI заголовков дней
        await loadDayDetails();
        renderDaysHeader(currentWeekStart);
        closeDayDetailModal();
    });
}

// Обработчик для кнопки отмены деталей дня
if (cancelDayDetailsBtn) {
    cancelDayDetailsBtn.addEventListener('click', () => {
        closeDayDetailModal();
    });
}

console.log("Main script initialized and listeners attached.");
// НОВАЯ ФУНКЦИЯ для смены статуса из модального окна
async function handleRegularEventToggle(instanceId, newCompletionState) {
    // Найти существующее событие или создать новое для записи статуса
    let event = calendarEvents.find(ev => ev.id === instanceId);

    if (event) {
        event.completed = newCompletionState;
    } else {
        // Если события еще не было в массиве, создаем его
        const [, configId, dateStr] = instanceId.split('-');
        const config = regularEventsConfig.find(c => c.id == configId);
        if (!config) {
            console.error("Не найдена конфигурация для регулярного события:", configId);
            return;
        }

        event = {
            id: instanceId,
            title: config.name,
            date: dateStr,
            type: 'regular',
            completed: newCompletionState,
            startTime: `${dateStr}T${config.time}`,
            endTime: `${dateStr}T${config.time}` // Длительность условна
        };
        calendarEvents.push(event);
    }
    
    // Сохраняем все события в хранилище. onChanged listener перерисует UI.
    storage.set({ calendarEvents });
}


function initializeEventHandlers() {
    // Обработчики для кнопок навигации по неделям
    if (elements.prevWeekBtn) {
        elements.prevWeekBtn.addEventListener('click', () => {
            currentDate.setDate(currentDate.getDate() - 7);
            currentWeekStart = getStartOfWeek(currentDate);
            updateWeekView(currentWeekStart);
        });
    }
    
    if (elements.currentWeekBtn) {
        elements.currentWeekBtn.addEventListener('click', () => {
            currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0);
            currentWeekStart = getStartOfWeek(currentDate);
            updateWeekView(currentWeekStart);
        });
    }
    
    if (elements.nextWeekBtn) {
        elements.nextWeekBtn.addEventListener('click', () => {
            currentDate.setDate(currentDate.getDate() + 7);
            currentWeekStart = getStartOfWeek(currentDate);
            updateWeekView(currentWeekStart);
        });
    }
    
    // Обработчики для модального окна деталей дня
    if (elements.dayDetailModal) {
        const closeDayDetailBtn = elements.dayDetailModal.querySelector('.close-modal');
        if (closeDayDetailBtn) {
            closeDayDetailBtn.addEventListener('click', closeDayDetailModal);
        }
    }
    
    if (elements.saveDayDetailsBtn) {
        elements.saveDayDetailsBtn.addEventListener('click', saveDayDetails);
    }
    
    if (elements.cancelDayDetailsBtn) {
        elements.cancelDayDetailsBtn.addEventListener('click', closeDayDetailModal);
    }

    // Обработчики для модального окна событий
    if (elements.eventModal) {
        const closeEventBtn = elements.eventModal.querySelector('.close-modal');
        if (closeEventBtn) {
            closeEventBtn.addEventListener('click', closeEventModal);
        }
    }
    
    if (elements.saveEventBtn) {
        elements.saveEventBtn.addEventListener('click', saveEvent);
    }
    
    if (elements.deleteEventBtn) {
        elements.deleteEventBtn.addEventListener('click', deleteEvent);
    }
    
    if (elements.cancelEventBtn) {
        elements.cancelEventBtn.addEventListener('click', closeEventModal);
    }
    
    // Обработчики для сетки времени
    if (elements.weekGrid) {
        elements.weekGrid.addEventListener('click', (e) => {
            const hourCell = e.target.closest('.hour-cell');
            if (hourCell) {
                const hour = parseFloat(hourCell.dataset.hour);
                const dateStr = hourCell.closest('.day-column').dataset.date;
                if (!isNaN(hour) && dateStr) {
                    openEventModal(null, dateStr, hour);
                }
            }
        });
    }
    
    // Слушатель изменений в storage только если мы в контексте расширения
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        storage.onChanged.addListener(async (changes, area) => {
            if (area === "local") {
                let eventsRefreshNeeded = false;
                let projectsRefreshNeeded = false;
                let dayHeadersRefreshNeeded = false;
                let projectStatsRefreshNeeded = false;

                if ('calendarEvents' in changes) {
                    calendarEvents = changes.calendarEvents.newValue || [];
                    console.log("[ON CHANGED] calendarEvents changed, new count:", calendarEvents.length);
                    eventsRefreshNeeded = true;
                    projectStatsRefreshNeeded = true; 
                }
                if ('projects' in changes) {
                    projects = changes.projects.newValue || [];
                    projectsRefreshNeeded = true;
                    projectStatsRefreshNeeded = true; 
                }
                if ('selectedProjectId' in changes) {
                    selectedProjectId = changes.selectedProjectId.newValue || null;
                    projectStatsRefreshNeeded = true;
                    if (elements.eventModalProjectSelect) {
                        elements.eventModalProjectSelect.value = selectedProjectId || "";
                    }
                }
                if (ALL_DAY_DETAILS_KEY in changes) {
                    allDayDetailsData = changes[ALL_DAY_DETAILS_KEY].newValue || {};
                    dayHeadersRefreshNeeded = true;
                }

                // Apply refreshes
                if (projectsRefreshNeeded) {
                    renderProjectSelectAndList();
                    renderProjectsList();
                }
                if (eventsRefreshNeeded) {
                    renderEvents();
                }
                if (dayHeadersRefreshNeeded) {
                    renderDaysHeader(currentWeekStart);
                }
                if (projectStatsRefreshNeeded) {
                    renderProjectStats(selectedProjectId);
                }
            }
        });
    }
}

function updateTotalCaloriesDisplay() {
    if (!elements.totalCaloriesValueSpan || !elements.caloriesMorningInput || 
        !elements.caloriesAfternoonInput || !elements.caloriesEveningInput) return;
    
    const morning = parseInt(elements.caloriesMorningInput.value) || 0;
    const afternoon = parseInt(elements.caloriesAfternoonInput.value) || 0;
    const evening = parseInt(elements.caloriesEveningInput.value) || 0;
    elements.totalCaloriesValueSpan.textContent = (morning + afternoon + evening).toString();
}

async function initialLoad() {
    console.log('[INITIAL LOAD] Начало initialLoad...');
    
    try {
        // Загрузка конфигураций регулярных событий
        const { regularEventsConfig } = await storage.get('regularEventsConfig');
        console.log('[INITIAL LOAD] Загружены конфигурации регулярных событий:', regularEventsConfig?.length || 0);
        
        // Загрузка проектов
        projects = await db.getProjects();
        console.log('[INITIAL LOAD] Projects loaded:', projects);

        // Проверка состояния секундомера
        const { stopwatch: savedStopwatch } = await storage.get('stopwatch');
        if (savedStopwatch?.isRunning && savedStopwatch?.liveEventId) {
            console.log('[INITIAL LOAD] Обнаружен запущенный секундомер, проверяем состояние...');
            try {
                // Проверяем состояние события в базе
                const event = await db.getCalendarEvent(savedStopwatch.liveEventId);
                if (event && event.is_live) {
                    console.log('[INITIAL LOAD] Событие все еще активно, восстанавливаем секундомер');
                    stopwatch = savedStopwatch;
                    startStopwatch();
                } else {
                    console.log('[INITIAL LOAD] Событие уже финализировано, сбрасываем состояние');
                    stopwatch = {
                        isRunning: false,
                        startTime: null,
                        elapsedTime: 0,
                        liveEventId: null,
                        isSyncedWithSupabase: false,
                        lastSupabaseSync: 0
                    };
                    persistStopwatchState();
                }
            } catch (error) {
                console.error('[INITIAL LOAD] Ошибка при проверке состояния события:', error);
                stopwatch = {
                    isRunning: false,
                    startTime: null,
                    elapsedTime: 0,
                    liveEventId: null,
                    isSyncedWithSupabase: false,
                    lastSupabaseSync: 0
                };
                persistStopwatchState();
            }
        }

        // Загрузка событий для текущей недели
        const weekDates = getWeekDates(currentWeekStart);
        console.log('[INITIAL LOAD] Текущая неделя:', weekDates);
        
        const startDate = weekDates[0];
        const endDate = weekDates[weekDates.length - 1];
        
        console.log('[INITIAL LOAD] Loading events from', startDate, 'to', endDate);
        calendarEvents = await db.getCalendarEvents(startDate, endDate);
        console.log('[INITIAL LOAD] Calendar events loaded:', calendarEvents);
        
        // Генерируем регулярные события для текущей недели
        await generateRegularEventsForWeek(currentWeekStart);
        
        // Рендеринг UI в правильном порядке
        renderProjectSelectAndList();
        renderProjectsList();
        await updateWeekView(currentWeekStart);
        
        console.log('[INITIAL LOAD] initialLoad завершен.');
    } catch (error) {
        console.error('[INITIAL LOAD] Error during initial load:', error);
    }
}

// Функция для проверки и синхронизации высоты элементов
function validateAndSyncHeights() {
    const timeSlotsContainer = elements.timeSlotsContainer;
    const weekGrid = elements.weekGrid;
    
    if (!timeSlotsContainer || !weekGrid) {
        console.error('[VALIDATE HEIGHTS] Не найдены необходимые элементы');
        return false;
    }

    // Проверяем высоту ячеек времени
    const timeSlots = timeSlotsContainer.querySelectorAll('.time-slot');
    const hourCells = weekGrid.querySelectorAll('.hour-cell');
    
    if (timeSlots.length !== hourCells.length) {
        console.error('[VALIDATE HEIGHTS] Несоответствие количества ячеек:', {
            timeSlots: timeSlots.length,
            hourCells: hourCells.length
        });
        return false;
    }

    // Проверяем высоту каждой ячейки
    for (let i = 0; i < timeSlots.length; i++) {
        const timeSlotHeight = timeSlots[i].offsetHeight;
        const hourCellHeight = hourCells[i].offsetHeight;
        
        if (timeSlotHeight !== HOUR_CELL_HEIGHT || hourCellHeight !== HOUR_CELL_HEIGHT) {
            console.error('[VALIDATE HEIGHTS] Несоответствие высоты ячеек:', {
                index: i,
                timeSlotHeight,
                hourCellHeight,
                expectedHeight: HOUR_CELL_HEIGHT
            });
            return false;
        }
    }

    return true;
}

// Функция для синхронизации скролла
function syncScroll() {
    const scrollContainer = document.getElementById('week-grid-scroll-container');
    if (!scrollContainer) return;

    // Синхронизируем скролл всех элементов внутри scrollable-content
    const scrollableContent = scrollContainer.querySelector('.scrollable-content');
    if (!scrollableContent) return;

    const elements = scrollableContent.children;
    let lastScrollTop = 0;

    scrollContainer.addEventListener('scroll', () => {
        const currentScrollTop = scrollContainer.scrollTop;
        if (currentScrollTop !== lastScrollTop) {
            for (let i = 0; i < elements.length; i++) {
                elements[i].scrollTop = currentScrollTop;
            }
            lastScrollTop = currentScrollTop;
        }
    });
}

// Обновляем функцию renderWeekGrid
function renderWeekGrid(weekStart) {
    const weekGrid = elements.weekGrid;
    if (!weekGrid) {
        console.error("[RENDER WEEK GRID] Не найден элемент #week-grid");
        return;
    }

    weekGrid.innerHTML = '';
    const weekDates = getWeekDates(weekStart);
    console.log('[RENDER WEEK GRID] Даты недели:', weekDates.map(d => formatDate(d)));
    
    // Создаем колонки для каждого дня недели
    weekDates.forEach(date => {
        const dayColumn = document.createElement('div');
        dayColumn.className = 'day-column';
        const dateStr = formatDate(date);
        dayColumn.setAttribute('data-date', dateStr);
        
        // Создаем ячейки для каждого часа
        for (let hour = 0; hour <= 23; hour++) {
            const hourCell = document.createElement('div');
            hourCell.className = 'hour-cell';
            hourCell.setAttribute('data-hour', hour.toString());
            hourCell.style.height = `${HOUR_CELL_HEIGHT}px`;
            
            // Обработчик клика для создания нового события
            hourCell.addEventListener('click', (e) => {
                if (e.target.closest('.calendar-event')) {
                    return;
                }
                openEventModal(null, dateStr, hour);
            });
            
            dayColumn.appendChild(hourCell);
        }
        
        weekGrid.appendChild(dayColumn);
    });

    // Создаем временные метки
    if (elements.timeSlotsContainer) {
        elements.timeSlotsContainer.innerHTML = '';
        for (let hour = 0; hour <= 23; hour++) {
            const timeSlot = document.createElement('div');
            timeSlot.className = 'time-slot';
            timeSlot.style.height = `${HOUR_CELL_HEIGHT}px`;
            timeSlot.textContent = `${pad(hour)}:00`;
            elements.timeSlotsContainer.appendChild(timeSlot);
        }
    }

    // Проверяем и синхронизируем высоты
    if (!validateAndSyncHeights()) {
        console.error('[RENDER WEEK GRID] Ошибка валидации высот элементов');
    }

    // Инициализируем синхронизацию скролла
    syncScroll();
}

// Обновляем функцию updateWeekView
async function updateWeekView(weekStart) {
    console.log('[UPDATE WEEK VIEW] Начало обновления вида недели...');
    
    try {
        // Обновляем заголовки дней
        renderDaysHeader(weekStart);
        
        // Рендерим сетку недели
        renderWeekGrid(weekStart);
        
        // Загружаем и отображаем события
        const events = await loadEvents(weekStart);
        renderEvents(events, weekStart);
        
        // Скроллим к рабочим часам
        scrollToWorkingHours();
        
        // Обновляем индикатор текущего времени
        updateCurrentTimeIndicator();
        
        console.log('[UPDATE WEEK VIEW] Обновление вида недели завершено');
    } catch (error) {
        console.error('[UPDATE WEEK VIEW] Ошибка при обновлении вида недели:', error);
    }
}

function renderTimeSlots() {
    const timeSlotsContainer = document.querySelector('.time-slots-container');
    if (!timeSlotsContainer) {
        console.error("Не найден контейнер time-slots-container!");
        return;
    }
    
    timeSlotsContainer.innerHTML = '';
    
    for (let h = 0; h <= 23; h++) {
        const div = document.createElement('div');
        div.className = 'time-slot';
        div.setAttribute('data-hour', h.toString());
        div.textContent = `${pad(h)}:00`;
        timeSlotsContainer.appendChild(div);
    }
}

function scrollToWorkingHours() {
    const scrollContainer = document.getElementById('week-grid-scroll-container');
    if (!scrollContainer) return;
    
    const hourCells = document.querySelectorAll('.hour-cell[data-hour="8"]');
    if (hourCells.length > 0) {
        scrollContainer.scrollTop = hourCells[0].offsetTop;
    }
}

async function openDayDetailModal(dateStr) {
    console.log('[OPEN DAY DETAIL] Открытие модального окна для дня:', dateStr);
    
    const modal = elements.dayDetailModal;
    if (!modal) {
        console.error('[OPEN DAY DETAIL] Модальное окно не найдено');
        return;
    }
    
    try {
        // Загружаем детали дня
        const details = await loadDayDetails(dateStr);
        console.log('[OPEN DAY DETAIL] Загруженные детали:', details);
        
        // Заполняем форму
        if (elements.dayDetailModalDateDisplay) elements.dayDetailModalDateDisplay.textContent = dateStr;
        if (elements.caloriesMorningInput) elements.caloriesMorningInput.value = details.calories?.morning || 0;
        if (elements.caloriesAfternoonInput) elements.caloriesAfternoonInput.value = details.calories?.afternoon || 0;
        if (elements.caloriesEveningInput) elements.caloriesEveningInput.value = details.calories?.evening || 0;
        if (elements.commentInput) elements.commentInput.value = details.comment || '';
        if (elements.totalCaloriesValueSpan) elements.totalCaloriesValueSpan.textContent = ((details.calories?.morning || 0) + (details.calories?.afternoon || 0) + (details.calories?.evening || 0)).toString();
        
        // Сохраняем дату в dataset модального окна
        modal.dataset.date = dateStr;
        
        // Показываем модальное окно
        modal.style.display = 'block';
    } catch (error) {
        console.error('[OPEN DAY DETAIL] Ошибка при открытии модального окна:', error);
        alert('Ошибка при загрузке деталей дня: ' + error.message);
    }
}

async function loadDayDetails(dateStr) {
    console.log('[LOAD DAY DETAILS] Загрузка деталей для дня:', dateStr);
    
    try {
        const { data, error } = await supabase
            .from('day_details')
            .select('*')
            .eq('date', dateStr)
            .single();
        
        if (error) {
            console.error('[LOAD DAY DETAILS] Ошибка при загрузке деталей:', error);
            return {};
        }
        
        return data || {};
    } catch (error) {
        console.error('[LOAD DAY DETAILS] Ошибка при загрузке деталей:', error);
        return {};
    }
}

async function saveDayDetails(date, detailsToSave) {
    console.log('[SAVE DAY DETAILS] Сохранение деталей для дня:', date, detailsToSave);
    
    try {
        const { error } = await supabase
            .from('day_details')
            .upsert({
                date: date,
                ...detailsToSave
            });
        
        if (error) {
            throw error;
        }
        
        console.log('[SAVE DAY DETAILS] Детали успешно сохранены');
    } catch (error) {
        console.error('[SAVE DAY DETAILS] Ошибка при сохранении деталей:', error);
        throw error;
    }
}

// Добавляем обработчик beforeunload для финализации события при закрытии вкладки
window.addEventListener('beforeunload', async (event) => {
    if (stopwatch.isRunning) {
        // Пытаемся финализировать событие перед закрытием
        try {
            await stopOrPauseStopwatch(true);
        } catch (error) {
            console.error('[BEFOREUNLOAD] Ошибка при финализации события:', error);
        }
    }
});

// Функция для проверки пересечения регулярных событий
function checkRegularEventOverlap(newEvent, existingEvents) {
    const newStartTime = new Date(`2000-01-01T${newEvent.start_time}`);
    const newEndTime = new Date(`2000-01-01T${newEvent.end_time}`);
    
    return existingEvents.some(event => {
        if (event.type !== 'regular') return false;
        
        const eventStartTime = new Date(`2000-01-01T${event.start_time}`);
        const eventEndTime = new Date(`2000-01-01T${event.end_time}`);
        
        // Проверяем пересечение дней недели
        const hasCommonDays = newEvent.weekdays.some(day => event.weekdays.includes(day));
        if (!hasCommonDays) return false;
        
        // Проверяем пересечение времени
        return (newStartTime < eventEndTime && newEndTime > eventStartTime);
    });
}

// Функция для создания регулярного события
async function createRegularEvent(eventData) {
    console.log('[CREATE REGULAR EVENT] Создание регулярного события:', eventData);
    
    try {
        // Проверяем обязательные поля
        if (!eventData.name || !eventData.start_time || !eventData.end_time || !eventData.weekdays?.length) {
            throw new Error('Не все обязательные поля заполнены');
        }
        
        // Загружаем существующие регулярные события
        const { regularEventsConfig } = await storage.get('regularEventsConfig');
        const existingEvents = regularEventsConfig || [];
        
        // Проверяем пересечение с существующими событиями
        if (checkRegularEventOverlap(eventData, existingEvents)) {
            throw new Error('Событие пересекается с существующим регулярным событием');
        }
        
        // Создаем новое событие
        const newEvent = {
            id: generateUUID(),
            name: eventData.name,
            start_time: eventData.start_time,
            end_time: eventData.end_time,
            weekdays: eventData.weekdays,
            created_at: new Date().toISOString()
        };
        
        // Добавляем в массив и сохраняем
        existingEvents.push(newEvent);
        await storage.set({ regularEventsConfig: existingEvents });
        
        // Генерируем события для текущей недели
        await generateRegularEventsForWeek(currentWeekStart);
        
        console.log('[CREATE REGULAR EVENT] Регулярное событие успешно создано');
        return newEvent;
    } catch (error) {
        console.error('[CREATE REGULAR EVENT] Ошибка при создании регулярного события:', error);
        throw error;
    }
}

// Функция для генерации регулярных событий на неделю
async function generateRegularEventsForWeek(weekStart) {
    console.log('[GENERATE REGULAR EVENTS] Генерация событий для недели:', formatDate(weekStart));
    
    try {
        // Загружаем конфигурации регулярных событий
        const { regularEventsConfig } = await storage.get('regularEventsConfig');
        if (!regularEventsConfig?.length) return;
        
        // Получаем даты недели
        const weekDates = getWeekDates(weekStart);
        
        // Для каждого регулярного события
        for (const config of regularEventsConfig) {
            // Для каждого дня недели в конфигурации
            for (const weekday of config.weekdays) {
                // Находим дату этого дня недели
                const eventDate = weekDates.find(date => date.getDay() === parseInt(weekday));
                if (!eventDate) continue;
                
                // Проверяем, нет ли уже такого события
                const existingEvent = calendarEvents.find(ev => 
                    ev.date === formatDate(eventDate) && 
                    ev.start_time === config.start_time &&
                    ev.type === 'regular'
                );
                
                if (existingEvent) continue;
                
                // Создаем новое событие
                const eventData = {
                    title: config.name,
                    date: formatDate(eventDate),
                    start_time: config.start_time,
                    end_time: config.end_time,
                    type: 'regular',
                    completed: false,
                    instance_id: `regular-${config.id}-${formatDate(eventDate)}`
                };
                
                // Сохраняем в базу
                await db.createCalendarEvent(eventData);
            }
        }
        
        // Перезагружаем события для недели
        await loadEvents(weekStart);
        
        console.log('[GENERATE REGULAR EVENTS] События успешно сгенерированы');
    } catch (error) {
        console.error('[GENERATE REGULAR EVENTS] Ошибка при генерации событий:', error);
    }
}

// Обновляем функцию handleRegularEventToggle
async function handleRegularEventToggle(instanceId, newCompletionState) {
    console.log('[TOGGLE REGULAR EVENT] Изменение статуса события:', { instanceId, newCompletionState });
    
    try {
        // Находим событие в базе
        const event = await db.getCalendarEvent(instanceId);
        if (!event) {
            throw new Error('Событие не найдено');
        }
        
        // Обновляем статус в базе
        await db.updateCalendarEvent(instanceId, {
            completed: newCompletionState
        });
        
        // Обновляем локальное состояние
        const localEvent = calendarEvents.find(ev => ev.id === instanceId);
        if (localEvent) {
            localEvent.completed = newCompletionState;
        }
        
        // Перерисовываем события
        renderEvents(calendarEvents, currentWeekStart);
        
        console.log('[TOGGLE REGULAR EVENT] Статус события успешно обновлен');
    } catch (error) {
        console.error('[TOGGLE REGULAR EVENT] Ошибка при обновлении статуса:', error);
        throw error;
    }
}

// Обновляем функцию initialLoad
async function initialLoad() {
    console.log('[INITIAL LOAD] Начало initialLoad...');
    
    try {
        // Загрузка конфигураций регулярных событий
        const { regularEventsConfig } = await storage.get('regularEventsConfig');
        console.log('[INITIAL LOAD] Загружены конфигурации регулярных событий:', regularEventsConfig?.length || 0);
        
        // Загрузка проектов
        projects = await db.getProjects();
        console.log('[INITIAL LOAD] Projects loaded:', projects);

        // Проверка состояния секундомера
        const { stopwatch: savedStopwatch } = await storage.get('stopwatch');
        if (savedStopwatch?.isRunning && savedStopwatch?.liveEventId) {
            console.log('[INITIAL LOAD] Обнаружен запущенный секундомер, проверяем состояние...');
            try {
                // Проверяем состояние события в базе
                const event = await db.getCalendarEvent(savedStopwatch.liveEventId);
                if (event && event.is_live) {
                    console.log('[INITIAL LOAD] Событие все еще активно, восстанавливаем секундомер');
                    stopwatch = savedStopwatch;
                    startStopwatch();
                } else {
                    console.log('[INITIAL LOAD] Событие уже финализировано, сбрасываем состояние');
                    stopwatch = {
                        isRunning: false,
                        startTime: null,
                        elapsedTime: 0,
                        liveEventId: null,
                        isSyncedWithSupabase: false,
                        lastSupabaseSync: 0
                    };
                    persistStopwatchState();
                }
            } catch (error) {
                console.error('[INITIAL LOAD] Ошибка при проверке состояния события:', error);
                stopwatch = {
                    isRunning: false,
                    startTime: null,
                    elapsedTime: 0,
                    liveEventId: null,
                    isSyncedWithSupabase: false,
                    lastSupabaseSync: 0
                };
                persistStopwatchState();
            }
        }

        // Загрузка событий для текущей недели
        const weekDates = getWeekDates(currentWeekStart);
        console.log('[INITIAL LOAD] Текущая неделя:', weekDates);
        
        const startDate = weekDates[0];
        const endDate = weekDates[weekDates.length - 1];
        
        console.log('[INITIAL LOAD] Loading events from', startDate, 'to', endDate);
        calendarEvents = await db.getCalendarEvents(startDate, endDate);
        console.log('[INITIAL LOAD] Calendar events loaded:', calendarEvents);
        
        // Генерируем регулярные события для текущей недели
        await generateRegularEventsForWeek(currentWeekStart);
        
        // Рендеринг UI в правильном порядке
        renderProjectSelectAndList();
        renderProjectsList();
        await updateWeekView(currentWeekStart);
        
        console.log('[INITIAL LOAD] initialLoad завершен.');
    } catch (error) {
        console.error('[INITIAL LOAD] Error during initial load:', error);
    }
}

// Добавляем функцию для валидации проекта
function validateProject(project) {
    if (!project.name) {
        throw new Error('Название проекта обязательно');
    }
    
    if (project.name.length > 50) {
        throw new Error('Название проекта не должно превышать 50 символов');
    }
    
    if (project.color && !/^#[0-9A-Fa-f]{6}$/.test(project.color)) {
        throw new Error('Некорректный формат цвета');
    }
    
    return true;
}

// Обновляем функцию createProject
async function createProject(projectData) {
    console.log('[CREATE PROJECT] Создание проекта:', projectData);
    
    try {
        // Валидация данных проекта
        validateProject(projectData);
        
        // Проверка на дубликаты
        const existingProject = projects.find(p => p.name.toLowerCase() === projectData.name.toLowerCase());
        if (existingProject) {
            throw new Error('Проект с таким названием уже существует');
        }
        
        // Создаем проект в базе данных
        const newProject = await syncWithSupabaseWithRetry(async () => {
            const { data, error } = await supabase
                .from('projects')
                .insert([{
                    ...projectData,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }])
                .select()
                .single();
                
            if (error) throw error;
            return data;
        });
        
        // Добавляем в локальное состояние
        projects.push(newProject);
        
        // Обновляем UI
        renderProjectSelectAndList();
        renderProjectsList();
        
        console.log('[CREATE PROJECT] Проект успешно создан');
        return newProject;
    } catch (error) {
        console.error('[CREATE PROJECT] Ошибка при создании проекта:', error);
        throw error;
    }
}

// Обновляем функцию updateProject
async function updateProject(projectId, updates) {
    console.log('[UPDATE PROJECT] Обновление проекта:', { projectId, updates });
    
    try {
        // Проверяем существование проекта
        const projectIndex = projects.findIndex(p => p.id === projectId);
        if (projectIndex === -1) {
            throw new Error('Проект не найден');
        }
        
        // Валидация обновленных данных
        validateProject({ ...projects[projectIndex], ...updates });
        
        // Проверка на дубликаты
        if (updates.name) {
            const existingProject = projects.find(p => 
                p.id !== projectId && 
                p.name.toLowerCase() === updates.name.toLowerCase()
            );
            if (existingProject) {
                throw new Error('Проект с таким названием уже существует');
            }
        }
        
        // Обновляем в базе данных
        const updatedProject = await syncWithSupabaseWithRetry(async () => {
            const { data, error } = await supabase
                .from('projects')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', projectId)
                .select()
                .single();
                
            if (error) throw error;
            return data;
        });
        
        // Обновляем локальное состояние
        projects[projectIndex] = updatedProject;
        
        // Обновляем UI
        renderProjectSelectAndList();
        renderProjectsList();
        
        // Если обновлен текущий проект, обновляем статистику
        if (selectedProjectId === projectId) {
            renderProjectStats(projectId);
        }
        
        console.log('[UPDATE PROJECT] Проект успешно обновлен');
        return updatedProject;
    } catch (error) {
        console.error('[UPDATE PROJECT] Ошибка при обновлении проекта:', error);
        throw error;
    }
}

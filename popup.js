document.addEventListener('DOMContentLoaded', function() {
    const timerDisplay = document.getElementById('timer-display');
    const startBtn = document.getElementById('start-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stopBtn = document.getElementById('stop-btn');
    const projectSelect = document.getElementById('project-select');
    const calendarBtn = document.getElementById('calendar-btn');

    let projects = [];
    let stopwatch = { isRunning: false, startTimestamp: null, elapsed: 0, liveEventId: null, projectId: null };
    let interval = null;

    function updateDisplay() {
        let ms = stopwatch.elapsed;
        if(stopwatch.isRunning && stopwatch.startTimestamp)
            ms += Date.now() - stopwatch.startTimestamp;
        let sec = Math.floor(ms/1000), min = Math.floor(sec/60);
        sec = sec%60;
        timerDisplay.textContent = `${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
        timerDisplay.style.color='#fff';
        startBtn.disabled = stopwatch.isRunning || !projectSelect.value;
        pauseBtn.disabled = !stopwatch.isRunning;
        stopBtn.disabled = (!stopwatch.isRunning && stopwatch.elapsed===0);
    }

    function loadProjects() {
        chrome.storage.local.get(['projects','selectedProjectId'], res => {
            projects = res.projects||[];
            projectSelect.innerHTML = `<option value="">-- Проект --</option>`;
            projects.forEach(prj=>{
                let opt = document.createElement('option');
                opt.value = prj.id; opt.textContent = prj.name;
                projectSelect.appendChild(opt);
            });
            if(res.selectedProjectId) projectSelect.value=res.selectedProjectId;
            updateDisplay();
        });
    }

    function loadStopwatch() {
        chrome.storage.local.get('stopwatch', res => {
            if(res.stopwatch) stopwatch = {...stopwatch, ...res.stopwatch};
            updateDisplay();
        });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if(area==="local" && changes.stopwatch) loadStopwatch();
        if(area==="local" && changes.projects) loadProjects();
    });

    startBtn.onclick = function() {
        let prj = projectSelect.value;
        if (!prj) { alert("Выберите проект!"); return; }
        chrome.storage.local.set({selectedProjectId:prj}, ()=> {
            chrome.storage.local.get(['stopwatch', 'calendarEvents', 'projects'], res=>{
                let sw = res.stopwatch||{};
                if (sw.isRunning) return;
                const projectsArr = res.projects || [];
                const project = projectsArr.find(p => p.id === prj);
                const now = new Date();
                const pad = x => x.toString().padStart(2, '0');
                const localIso = dt => dt.getFullYear() + '-' + pad(dt.getMonth()+1) + '-' + pad(dt.getDate()) + 'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
                const getLocalDateString = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
                const liveEv = {
                    id: `live-${Date.now()}`,
                    title: project ? project.name : "Без проекта",
                    description: "",
                    date: getLocalDateString(now),
                    startTime: localIso(now),
                    endTime: localIso(new Date(now.getTime() + 60000)),
                    projectId: prj,
                    isLive: true,
                    type: 'project'
                };
                const calendarEvents = res.calendarEvents || [];
                calendarEvents.push(liveEv);
                chrome.storage.local.set({
                    stopwatch: {isRunning:true, startTimestamp: Date.now(), elapsed:0, liveEventId: liveEv.id, projectId: prj},
                    calendarEvents
                });
            });
        });
    };
    pauseBtn.onclick = function() {
        chrome.storage.local.get(['stopwatch', 'calendarEvents'], res=>{
            let sw = res.stopwatch||{};
            if (!sw.isRunning) return;
            let elapsed = (sw.elapsed||0) + (Date.now()-sw.startTimestamp);
            let calendarEvents = res.calendarEvents || [];
            if (sw.liveEventId) {
                const evIdx = calendarEvents.findIndex(ev => ev.id === sw.liveEventId);
                if (evIdx > -1) calendarEvents[evIdx].isLive = false;
            }
            chrome.storage.local.set({
                stopwatch:{...sw,isRunning:false,startTimestamp:null,elapsed,projectId: sw.projectId||null},
                calendarEvents
            });
        });
    };
    stopBtn.onclick = function() {
        chrome.storage.local.get(['stopwatch', 'calendarEvents'], res=>{
            let sw = res.stopwatch||{};
            let calendarEvents = res.calendarEvents || [];
            if (sw.liveEventId) {
                const evIdx = calendarEvents.findIndex(ev => ev.id === sw.liveEventId);
                if (evIdx > -1) calendarEvents[evIdx].isLive = false;
            }
            chrome.storage.local.set({
                stopwatch:{isRunning:false,startTimestamp:null,elapsed:0,liveEventId:null,projectId:null},
                calendarEvents
            });
        });
    };

    projectSelect.onchange = function() {
        chrome.storage.local.get('stopwatch', res=>{
            let sw = res.stopwatch||{};
            if (sw.isRunning || sw.elapsed) {
                chrome.storage.local.set({stopwatch:{isRunning:false,startTimestamp:null,elapsed:0,liveEventId:null,projectId: projectSelect.value}});
            }
            chrome.storage.local.set({selectedProjectId: projectSelect.value});
        });
    };
    calendarBtn.onclick = function () {
        chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
    };

    loadProjects();
    loadStopwatch();
    setInterval(updateDisplay, 1000);
});

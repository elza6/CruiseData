
// ../JavaScripts/calendar-dialog.js
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const openCalendarBtn  = document.getElementById('openCalendarBtn');
  const calendarDialog   = document.getElementById('calendarDialog');
  const closeCalendarBtn = document.getElementById('closeCalendarBtn');

  const monthYearEl = document.getElementById('monthYear');
  const gridEl      = document.getElementById('calendarGrid');
  const prevBtn     = document.getElementById('prevBtn');
  const nextBtn     = document.getElementById('nextBtn');

  // Guard: ensure elements exist
  if (!openCalendarBtn || !calendarDialog || !closeCalendarBtn ||
      !monthYearEl || !gridEl || !prevBtn || !nextBtn) {
    console.error('Calendar dialog wiring error: one or more elements not found.');
    return;
  }

  // State: show the same month index as today, but in a chosen year
  let currentYear  = 2026; // lock to 2026; change if you want a dynamic year
  let currentMonth = new Date().getMonth();

  // === Calls data state ===
  const DATA_URL    = 'https://raw.githubusercontent.com/EDCStanalytics/CruiseData/refs/heads/calendar/Actuals/FutureCallData.csv';
  const DATE_COLUMN = 'ArrivalDate';     // <-- explicitly use your date column
  // Set this to your exact vessel header if you know it, e.g., 'Vessel' or 'ShipName'.
  // If left null, the script will try to auto-detect from common candidates.
  let VESSEL_COLUMN = null;              // e.g., 'Vessel'

  // Internal maps
  let callsByDayUpcoming = new Map();    // key: 'YYYY-MM-DD' -> count of upcoming calls
  let vesselsByDay       = new Map();    // key: 'YYYY-MM-DD' -> array of vessel names
  let callsLoaded        = false;

  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Helpers
  const openDialog = (dlg) => {
    if (!dlg) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', ''); // fallback if <dialog> not fully supported
  };
  const closeDialog = (dlg) => {
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  };
  const clickOutsideToClose = (dlg) => {
    dlg?.addEventListener('click', (e) => {
      const rect = dlg.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top  && e.clientY <= rect.bottom;
      if (!inside) closeDialog(dlg);
    });
  };

  const pad2 = (n) => String(n).padStart(2, '0');
  const keyFromDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const keyFromYMD  = (y, m, day) => `${y}-${pad2(m + 1)}-${pad2(day)}`;

  // Split a CSV line on commas not inside quotes
  function splitCSVLine(line) {
    const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    return parts.map(v => v.replace(/^"(.*)"$/,'$1').replace(/""/g,'"').trim());
  }

  // Try to parse common date formats
  function parseDateFlexible(s) {
    if (!s) return null;
    const tryNative = new Date(s);
    if (!isNaN(tryNative)) return tryNative;

    // MM/DD/YYYY
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2]);

    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

    // YYYY/MM/DD
    m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

    return null;
  }

  // Load CSV, lock to ArrivalDate; build callsByDayUpcoming + vesselsByDay (>= today)
  async function ensureCallsLoaded() {
    if (callsLoaded) return;
    try {
      const res  = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      const text = await res.text();

      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV appears empty or missing header.');

      const headers = splitCSVLine(lines[0]);

      // Date column index (ArrivalDate)
      const dateIdx = headers.indexOf(DATE_COLUMN);
      if (dateIdx === -1) {
        throw new Error(`Date column "${DATE_COLUMN}" not found in CSV header: [${headers.join(', ')}]`);
      }

      // Vessel column index (explicit or auto-detect)
      const vesselCandidates = ['Vessel','VesselName','Vessel Name','ShipName','Ship','Ship_Name','Vessel_Name'];
      let vesselIdx = -1;
      if (VESSEL_COLUMN) {
        vesselIdx = headers.indexOf(VESSEL_COLUMN);
        if (vesselIdx === -1) {
          console.warn(`Vessel column "${VESSEL_COLUMN}" not found in CSV header. Attempting auto-detect...`);
        }
      }
      if (vesselIdx === -1) {
        vesselIdx = headers.findIndex(h => vesselCandidates.includes(h));
        if (vesselIdx !== -1) VESSEL_COLUMN = headers[vesselIdx]; // record detected name
      }
      if (vesselIdx === -1) {
        // very loose fallback
        vesselIdx = headers.findIndex(h => /vessel|ship/i.test(h));
        if (vesselIdx !== -1) VESSEL_COLUMN = headers[vesselIdx];
      }
      if (vesselIdx === -1) {
        console.warn('No vessel column found. Tooltips will show call counts only.');
      } else {
        console.log(`Using vessel column: "${VESSEL_COLUMN}"`);
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const tempCountMap = new Map(); // key: 'YYYY-MM-DD' -> count
      const tempNamesMap = new Map(); // key: 'YYYY-MM-DD' -> [names]

      for (let i = 1; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i]);
        if (!cols || cols.length <= dateIdx) continue;

        const dateStr = cols[dateIdx];
        const dt = parseDateFlexible(dateStr);
        if (!dt) continue;

        // Only consider upcoming calls (>= today)
        if (dt >= todayStart) {
          const key = keyFromDate(dt);

          // Count
          tempCountMap.set(key, (tempCountMap.get(key) || 0) + 1);

          // Vessel names
          if (vesselIdx !== -1 && cols.length > vesselIdx) {
            const name = (cols[vesselIdx] || '').trim();
            if (name) {
              const list = tempNamesMap.get(key) || [];
              list.push(name);
              tempNamesMap.set(key, list);
            }
          }
        }
      }

      callsByDayUpcoming = tempCountMap;
      vesselsByDay       = tempNamesMap;
      callsLoaded        = true;

      console.log(
        `Loaded upcoming calls for ${callsByDayUpcoming.size} distinct day(s).`,
        Array.from(callsByDayUpcoming.entries()).slice(0, 5), '...'
      );
    } catch (err) {
      console.error('Error loading calls CSV:', err);
      callsByDayUpcoming = new Map();
      vesselsByDay       = new Map();
    }
  }

  function renderCalendar(month, year) {
    // Clear grid
    gridEl.innerHTML = '';

    // Header title
    monthYearEl.textContent = `${monthNames[month]} ${year}`;

    // Days of week row
    dayNames.forEach(d => {
      const dow = document.createElement('div');
      dow.className = 'calendar__dow';
      dow.textContent = d;
      gridEl.appendChild(dow);
    });

    // Layout math
    const firstDay    = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'calendar__cell calendar__cell--empty';
      gridEl.appendChild(empty);
    }

    // Day cells
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('div');
      cell.className = 'calendar__cell';
      cell.textContent = d;

      // Ensure dot positioning works even without external CSS
      cell.style.position = 'relative';

      const cellDate = new Date(year, month, d);
      cellDate.setHours(0, 0, 0, 0);
      const dateKey  = keyFromYMD(year, month, d);

      // Highlight today's date (if month/year match)
      if (today.getTime() === cellDate.getTime()) {
        cell.classList.add('calendar__cell--today');
      }

      // Add dot if this day has upcoming calls
      const count = callsByDayUpcoming.get(dateKey) || 0;
      const names = vesselsByDay.get(dateKey) || [];

      if (count > 0) {
        // Dot indicator (inline styles so no external CSS is needed)
        const dot = document.createElement('span');
        dot.className = 'calendar__dot';
        dot.title = `${count} upcoming call${count > 1 ? 's' : ''}`;
        dot.style.cssText = [
          'position:absolute',
          'bottom:6px',
          'left:50%',
          'transform:translateX(-50%)',
          'width:6px',
          'height:6px',
          'border-radius:50%',
          'background:#2b6cb0'
        ].join(';');
        cell.appendChild(dot);
        cell.classList.add('calendar__cell--has-call');

        // Native tooltip on the whole cell including vessel names (if found)
        const uniqueNames = Array.from(new Set(names));
        const tip = uniqueNames.length
          ? `Upcoming vessel${uniqueNames.length > 1 ? 's' : ''}:\n• ${uniqueNames.join('\n• ')}`
          : `${count} upcoming call${count > 1 ? 's' : ''}`;
        cell.title = tip;
      }

      // Example click handler (optional)
      cell.addEventListener('click', () => {
        const selected = new Date(year, month, d);
        const msg = `${selected.toLocaleDateString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric'
        })}` + (count > 0 ? ` — ${count} upcoming call${count > 1 ? 's' : ''}` : '');
        console.log('Selected date:', selected, 'Calls:', count, 'Vessels:', names);
        alert(`Selected: ${msg}`);
      });

      gridEl.appendChild(cell);
    }
  }

  // Wire up open/close
  openCalendarBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation(); // in case other listeners are attached elsewhere

    // Reset to 2026 each time you open (optional)
    currentYear  = 2026;
    currentMonth = new Date().getMonth();

    // Load calls before first render
    await ensureCallsLoaded();

    renderCalendar(currentMonth, currentYear);
    openDialog(calendarDialog);
  });

  closeCalendarBtn.addEventListener('click', () => closeDialog(calendarDialog));
  clickOutsideToClose(calendarDialog);

  // Navigation
  prevBtn.addEventListener('click', (e) => {
    e.preventDefault();
    currentMonth--;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear--;
    }
    renderCalendar(currentMonth, currentYear);
  });

  nextBtn.addEventListener('click', (e) => {
    e.preventDefault();
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
    renderCalendar(currentMonth, currentYear);
  });

  // No initial render; we render on open
});
``

const canvas = document.getElementById('bracketCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('nodesOverlay');
const statsPanel = document.getElementById('statsPanel');
const statsContent = document.getElementById('statsContent');
const closePanelBtn = document.getElementById('closePanelBtn');

// Define concentric track radii proportions (measured in % of viewport height/width minimum)
const RADII_PROPORTIONS = [43.5, 34.0, 25.0, 16.5, 9.8];
const TOTAL_ROUNDS = 5; 

let bracketTree = [];
let particles = [];

// Global dimension caching properties to stop frame dropping and layout thrashing
let cachedCx = 0;
let cachedCy = 0;
let cachedBaseRadius = 0;

// Hardware Accelerated Rotation Variables
let globalRotation = 0;
let ROTATION_SPEED = 0.0012; 

// Global State Trackers
let hoveredTeam = null;
let shockwaves = [];
let currentlySelectedMatch = null; // FEATURE 1: Tracks active card reference for countdowns
let countdownFrameCounter = 0;     //  Low-overhead interval throttle

// FEATURE: Kinetic Momentum Wheel States
let isDragging = false;
let hasDraggedSignificant = false;
let dragStartAngle = 0;
let dragStartRotation = 0;
let lastPointerAngle = 0;
let lastPointerTime = 0;
let angularVelocity = 0; // Tracks rotation speed in radians per millisecond

// Dynamic state tracking for tournament leaderboards
let liveScorers = [];
let liveAssistsTeams = [];
let liveDirtyTeams = [];       
let globalTournamentStats = {}; 

// User-customisable settings (Wallpaper Engine will call applyUserProperties)
const settings = {
    rotationSpeed: ROTATION_SPEED,
    glowIntensity: 1.0,
    showCenterGlow: true,
    audioReactive: true,
    gridColor: { r: 255, g: 255, b: 255 },
    backgroundColor: { r: 8, g: 8, b: 8 },
    winnerLineBase: 2.0
};

function parseWallpaperColor(property) {
    if (!property) return null;
    const color = property.color || property.value || property;
    if (!color) return null;
    if (typeof color === 'string') {
        const cleaned = color.trim();
        const hex = cleaned.startsWith('#') ? cleaned.slice(1) : cleaned;
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16)
            };
        }
        const parts = cleaned.split(/[\s,;]+/).map(Number).filter(n => !isNaN(n));
        if (parts.length >= 3) {
            const isFractional = parts[0] <= 1 && parts[1] <= 1 && parts[2] <= 1 &&
                                 (parts[0] > 0 || parts[1] > 0 || parts[2] > 0);
            const scale = isFractional ? 255 : 1;
            return {
                r: clampColor(Math.round(parts[0] * scale)),
                g: clampColor(Math.round(parts[1] * scale)),
                b: clampColor(Math.round(parts[2] * scale))
            };
        }
    }
    if (Array.isArray(color) && color.length >= 3) {
        const isFractional = color[0] <= 1 && color[1] <= 1 && color[2] <= 1 &&
                             (color[0] > 0 || color[1] > 0 || color[2] > 0);
        const scale = isFractional ? 255 : 1;
        return {
            r: clampColor(Math.round(Number(color[0]) * scale)),
            g: clampColor(Math.round(Number(color[1]) * scale)),
            b: clampColor(Math.round(Number(color[2]) * scale))
        };
    }
    if (typeof color === 'object' && color.r !== undefined && color.g !== undefined && color.b !== undefined) {
        return {
            r: clampColor(Number(color.r)),
            g: clampColor(Number(color.g)),
            b: clampColor(Number(color.b))
        };
    }
    return null;
}

function clampColor(value) {
    if (Number.isFinite(value)) {
        return Math.min(255, Math.max(0, Math.round(value)));
    }
    return 0;
}

// CINEMATIC LOADING EASING ENGINES
function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
}

function easeOutBack(x) {
    const c1 = 1.15; // Controls the elastic spring overshoot amount
    const c3 = c1 + 1;
    return x === 0 ? 0 : x === 1 ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

let audioBass = 0;
let loadProgress = 0;
let isLoadAnimating = true;

const initialTeams = [
    "de", "py", "fr", "se", "za", "ca", "nl", "ma", 
    "pt", "hr", "es", "at", "us", "ba", "be", "sn", 
    "gh", "co", "dz", "ch", "eg", "au", "cv", "ar", 
    "cd", "gb-eng", "ec", "mx", "no", "ci", "jp", "br"
];

const FLAG_COLORS = {
    "de": "#FFD100", "py": "#D52B1E", "fr": "#002395", "se": "#006AA7",
    "za": "#007A4D", "ca": "#FF0000", "nl": "#21468B", "ma": "#C1272D",
    "pt": "#006600", "hr": "#FF0000", "es": "#FFC400", "at": "#EF3340",
    "us": "#B22234", "ba": "#002395", "be": "#FFCD00", "sn": "#00853F",
    "gh": "#FCD116", "co": "#FCD116", "dz": "#006233", "ch": "#DA291C",
    "eg": "#C09304", "au": "#00008B", "cv": "#0038A8", "ar": "#74ACDF",
    "cd": "#007FFF", "gb-eng": "#CE1126", "ec": "#FFDD00", "mx": "#006847",
    "no": "#EF3340", "ci": "#FF8200", "jp": "#BC002D", "br": "#009739"
};

const ESPN_TO_ISO = {
    "GER": "de", "PAR": "py", "FRA": "fr", "SWE": "se",
    "RSA": "za", "CAN": "ca", "NED": "nl", "MAR": "ma",
    "POR": "pt", "CRO": "hr", "ESP": "es", "AUT": "at",
    "USA": "us", "BIH": "ba", "BEL": "be", "SEN": "sn",
    "GHA": "gh", "COL": "co", "ALG": "dz", "SUI": "ch",
    "EGY": "eg", "AUS": "au", "CPV": "cv", "ARG": "ar",
    "COD": "cd", "ENG": "gb-eng", "ECU": "ec", "MEX": "mx",
    "NOR": "no", "CIV": "ci", "JPN": "jp", "BRA": "br"
};

class SparkParticle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        const trajectoryAngle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 + 2; 
        this.vx = Math.cos(trajectoryAngle) * speed;
        this.vy = Math.sin(trajectoryAngle) * speed;
        this.radius = Math.random() * 2.5 + 1.5; 
        this.alpha = 1;
        this.decay = Math.random() * 0.015 + 0.012;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.vx *= 0.97; this.vy *= 0.97;
        this.alpha -= this.decay;
    }
    draw(context) {
        context.save();
        context.globalAlpha = this.alpha;
        context.beginPath();
        context.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.shadowColor = this.color;
        context.shadowBlur = 12;
        context.fill();
        context.restore();
    }
}

function buildTreeStructure() {
    bracketTree = [];
    for (let round = 0; round < TOTAL_ROUNDS; round++) {
        const teamsInRound = 32 / Math.pow(2, round);
        bracketTree[round] = [];

        for (let i = 0; i < teamsInRound; i++) {
            let angle = 0;
            if (round === 0) {
                const rotationOffset = (45 * Math.PI) / 180; 
                angle = ((i * 2 * Math.PI) / teamsInRound) + rotationOffset;            
            } else {
                const childAngle1 = bracketTree[round - 1][i * 2].angle;
                const childAngle2 = bracketTree[round - 1][i * 2 + 1].angle;
                angle = (childAngle1 + childAngle2) / 2;
            }

            bracketTree[round].push({ 
                angle, 
                label: round === 0 ? initialTeams[i] : "", 
                isEmpty: round !== 0, 
                isLoser: false, 
                isLive: false,
                score: undefined,
                matchDataRef: null, 
                x: 0, y: 0 
            });
        }
    }
}

function getRoundProgress(round) {
    // Spreads duration intervals evenly across the absolute total round depth
    const roundDuration = 1 / TOTAL_ROUNDS; 
    const startPct = round * roundDuration;
    const progress = (loadProgress - startPct) / roundDuration;
    return Math.max(0, Math.min(1, progress));
}

function refreshNodeDOMStructures() {
    for (let round = 0; round < TOTAL_ROUNDS; round++) {
        bracketTree[round].forEach((node, index) => {
            let nodeDOM = document.getElementById(`node-${round}-${index}`);
            if (!nodeDOM) {
                nodeDOM = document.createElement('div');
                nodeDOM.id = `node-${round}-${index}`;
                
                // Interaction Layer
// Interaction Layer (Updated for Click-vs-Drag suppression)
nodeDOM.addEventListener('pointerdown', (event) => {
    // Only capture primary pointer clicks
    if (event.button !== 0) return;
    
    // Allow the main overlay container to intercept coordinates for physics tracking
    hasDraggedSignificant = false; 
    
    const clickTrackerUp = (upEvent) => {
        window.removeEventListener('pointerup', clickTrackerUp);
        // If the pointer did not transition into a significant drag throw, process click
        if (!hasDraggedSignificant) {
            handleNodeClickEvent(nodeDOM, node);
        }
    };
    window.addEventListener('pointerup', clickTrackerUp);
});

                // FIXED: Hover listeners moved inside the block where node and nodeDOM exist
                nodeDOM.addEventListener('pointerenter', () => { 
                    if (!node.isEmpty) {
                        hoveredTeam = node.label; 
                        drawCanvasContext(); 
                    }
                });
                nodeDOM.addEventListener('pointerleave', () => { 
                    hoveredTeam = null; 
                    drawCanvasContext(); 
                });

                container.appendChild(nodeDOM);
            }

            let stateClass = 'empty';
            if (!node.isEmpty) stateClass = 'advanced';
            if (node.isLoser) stateClass = 'loser';
            if (node.isLive) stateClass += ' live-pulse';
            if (nodeDOM.classList.contains('selected-view')) stateClass += ' selected-view';

            nodeDOM.className = `bracket-node round-${round} ${stateClass}`;
            
            let expectedHTML = "";
            if (!node.isEmpty) {
                let scoreOverlay = "";
                if (node.isLive && node.score !== undefined) {
                    scoreOverlay = `<span class="live-score-badge">${node.score}</span>`;
                }
                expectedHTML = `<img src="https://flagcdn.com/w160/${node.label}.png" class="flag-img" alt="${node.label}">${scoreOverlay}`;
            }

            if (nodeDOM.innerHTML !== expectedHTML) {
                nodeDOM.innerHTML = expectedHTML;
            }
        });
    }
}

async function fetchAndApplyLiveScores() {
    try {
        const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260720');
        if (!response.ok) throw new Error("API Network error response.");
        
        const data = await response.json();
        if (!data || !Array.isArray(data.events)) return;
		
		// === NEW: Compute leaderboards directly from the live data stream ===
        liveScorers = computeLiveScorers(data.events);
        liveAssistsTeams = computeLiveTeamAssists(data.events);
		liveDirtyTeams = computeLiveDisciplinaryTeams(data.events); 
		globalTournamentStats = computeGlobalTournamentStats(data.events);
        
        // If the user currently has the leaders tab open, refresh the elements instantly
        if (!leadersContentEl.classList.contains('hidden')) {
            renderLeadersDashboard();
        }
        // ==================================================================

        const eventMap = new Map();
        for (const evt of data.events) {
            const comps = evt?.competitions?.[0]?.competitors;
            if (!Array.isArray(comps) || comps.length < 2) continue;
            const abbr0 = ESPN_TO_ISO[String(comps[0]?.team?.abbreviation || '').toUpperCase()];
            const abbr1 = ESPN_TO_ISO[String(comps[1]?.team?.abbreviation || '').toUpperCase()];
            if (!abbr0 || !abbr1) continue;
            eventMap.set([abbr0, abbr1].sort().join('|'), evt);
        }

        for (let round = 0; round < TOTAL_ROUNDS; round++) {
            bracketTree[round].forEach(node => { 
                node.isLive = false; 
                node.matchDataRef = null; 
                node.isLoser = false;
            });
        }

        for (let round = 1; round < TOTAL_ROUNDS; round++) {
            const teamsInRound = 32 / Math.pow(2, round);
            for (let i = 0; i < teamsInRound; i++) {
                const child1 = bracketTree[round - 1][i * 2];
                const child2 = bracketTree[round - 1][i * 2 + 1];

                if (!child1.isEmpty && !child2.isEmpty) {
                    const matchKey = [child1.label, child2.label].sort().join('|');
                    const match = eventMap.get(matchKey);
                    if (match) {
                        const competitors = match?.competitions?.[0]?.competitors || [];
                        const matchState = match?.status?.type?.state; 

                        child1.matchDataRef = match;
                        child2.matchDataRef = match;

                        if (matchState === "in") {
                            child1.isLive = true; child2.isLive = true;
                            const c1Data = competitors.find(c => ESPN_TO_ISO[c.team.abbreviation] === child1.label);
                            const c2Data = competitors.find(c => ESPN_TO_ISO[c.team.abbreviation] === child2.label);

                            if (c1Data && c2Data) {
                                const currentScore1 = parseInt(c1Data.score) || 0;
                                const currentScore2 = parseInt(c2Data.score) || 0;

                                if (child1.score !== undefined && currentScore1 > child1.score) {
                                    triggerParticleBlast(child1.x, child1.y, FLAG_COLORS[child1.label] || '#ffffff');
                                }
                                if (child2.score !== undefined && currentScore2 > child2.score) {
                                    triggerParticleBlast(child2.x, child2.y, FLAG_COLORS[child2.label] || '#ffffff');
                                }
                                child1.score = currentScore1; child2.score = currentScore2;
                            }
                        }

                        const winnerComp = competitors.find(c => c.winner === true);
                        if (winnerComp) {
                            const winnerIso = ESPN_TO_ISO[winnerComp.team.abbreviation];
                            bracketTree[round][i].matchDataRef = match;
                            
                            if (winnerIso === child1.label) {
                                bracketTree[round][i].label = child1.label;
                                bracketTree[round][i].isEmpty = false; child2.isLoser = true;
                            } else if (winnerIso === child2.label) {
                                bracketTree[round][i].label = child2.label;
                                bracketTree[round][i].isEmpty = false; child1.isLoser = true;
                            }
                        }
                    }
                }
            }
        }
        
        refreshNodeDOMStructures();
        syncLayoutPositions();
        drawCanvasContext();

        if (isLoadAnimating && loadProgress === 0) {
            animateLoadLoop();
        }

    } catch (error) {
        console.error("ESPN Query blocked by browser CORS policy. Activating sandbox fallback data mode:", error);
        
        for (let round = 1; round < TOTAL_ROUNDS; round++) {
            const teamsInRound = 32 / Math.pow(2, round);
            for (let i = 0; i < teamsInRound; i++) {
                const child1 = bracketTree[round - 1][i * 2];
                const child2 = bracketTree[round - 1][i * 2 + 1];
                
                if (!child1.isEmpty && !child2.isEmpty) {
                    const mockMatch = {
                        status: { type: { state: "post", detail: "Final Score" } },
                        date: new Date().toISOString(),
                        competitions: [{
                            altGameNote: round === 1 ? "Round of 16" : round === 2 ? "Quarter-Finals" : round === 3 ? "Semi-Finals" : "Grand Final",
                            competitors: [
                                { homeAway: "home", team: { displayName: child1.label.toUpperCase(), abbreviation: child1.label.toUpperCase() }, score: "3", winner: true, statistics: [{ name: "possessionPct", displayValue: "58%" }, { name: "totalShots", displayValue: "16" }, { name: "shotsOnTarget", displayValue: "7" }, { name: "wonCorners", displayValue: "6" }] },
                                { homeAway: "away", team: { displayName: child2.label.toUpperCase(), abbreviation: child2.label.toUpperCase() }, score: "1", winner: false, statistics: [{ name: "possessionPct", displayValue: "42%" }, { name: "totalShots", displayValue: "8" }, { name: "shotsOnTarget", displayValue: "2" }, { name: "wonCorners", displayValue: "3" }] }
                            ]
                        }]
                    };
                    
                    child1.matchDataRef = mockMatch;
                    child2.matchDataRef = mockMatch;
                    
                    bracketTree[round][i].label = child1.label;
                    bracketTree[round][i].isEmpty = false;
                    bracketTree[round][i].matchDataRef = mockMatch;
                    child2.isLoser = true;
                }
            }
        }
        refreshNodeDOMStructures();
        syncLayoutPositions();
        drawCanvasContext();

        // FIXED: Initiates animation loops even when running under sandbox fallback conditions
        if (isLoadAnimating && loadProgress === 0) {
            animateLoadLoop();
        }
    }
}

function syncLayoutPositions() {
    for (let round = 0; round < TOTAL_ROUNDS; round++) {
        const radiusPx = (RADII_PROPORTIONS[round] / 100) * cachedBaseRadius;
        const roundProg = getRoundProgress(round);
        
        bracketTree[round].forEach((node, index) => {
            let finalAngle = node.angle + globalRotation;
            
            const offsetX = radiusPx * Math.cos(finalAngle);
            const offsetY = radiusPx * Math.sin(finalAngle);
            node.x = cachedCx + offsetX;
            node.y = cachedCy + offsetY;

            const nodeDOM = document.getElementById(`node-${round}-${index}`);
            if (nodeDOM) {
                let transformString = `translate3d(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px), 0)`;
                
                if (nodeDOM.classList.contains('selected-view')) {
                    transformString += ` scale(1.12)`;
                } else if (isLoadAnimating) {
                    // FEATURE: Sequential Clockwise Stagger Matrix
                    // Delays nodes based on their positions around the wheel ring
                    const angularStaggerDelay = (index / bracketTree[round].length) * 0.22;
                    const throttledNodeProg = Math.max(0, Math.min(1, (roundProg - angularStaggerDelay) / (1 - angularStaggerDelay)));
                    
                    // Route values through premium easing formulas
                    const elasticScale = easeOutBack(throttledNodeProg);
                    const fluidOpacity = easeOutCubic(throttledNodeProg);
                    
                    nodeDOM.style.opacity = fluidOpacity;
                    transformString += ` scale(${0.1 + elasticScale * 0.9})`;
                } else {
                    nodeDOM.style.opacity = 1;
                }
                
                nodeDOM.style.transform = transformString;
            }
        });
    }
}

function handleNodeClickEvent(element, node) {
    if (!node.matchDataRef) return; 
    document.querySelectorAll('.bracket-node').forEach(n => n.classList.remove('selected-view'));
    element.classList.add('selected-view');
    
    currentlySelectedMatch = node.matchDataRef; // Cache active match dataset
    updateStatsPanelUI(node.matchDataRef);
    switchTabs('match'); // Auto-reset tab view back to match metrics when a flag is selected
    statsPanel.classList.add('panel-open');
}

// FEATURE 1 UTILITY: Calculates human-scannable ticking intervals relative to live clock
function calculateCountdownString(kickoffDateIso) {
    const timeDeltaMs = new Date(kickoffDateIso) - new Date();
    if (timeDeltaMs <= 0) return "Match Starting...";

    const netMinutes = Math.floor(timeDeltaMs / 1000 / 60);
    const netHours = Math.floor(netMinutes / 60);
    const partialMinutes = netMinutes % 60;
    
    if (netHours > 24) {
        return `Starts in ${Math.floor(netHours / 24)}d ${netHours % 24}h`;
    }
    if (netHours > 0) {
        return `Starts in ${netHours}h ${partialMinutes}m`;
    }
    return `Starts in ${partialMinutes}m`;
}

// FEATURE 1 RUNTIME ENGINE: Directly edits DOM textual layers to bypass full sidebar component template string redraw thrashing
function updateLiveCountdowns() {
    if (!currentlySelectedMatch) return;
	
	// SAFEGUARD: If the match state isn't upcoming ("pre"), exit immediately 
    // to protect completed scorelines from being overwritten by the ticker loop.
    if (currentlySelectedMatch.status?.type?.state !== "pre") return;
	
    const clockElement = document.querySelector('.match-clock');
    if (!clockElement) return;
    
    const targetISO = clockElement.getAttribute('data-kickoff');
    if (!targetISO) return;

    clockElement.textContent = calculateCountdownString(targetISO);
}

function updateStatsPanelUI(match) {
    if (!match) return;

    const comp = match?.competitions?.[0];
    if (!comp) return;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    const safeTeam = (team) => team || { team: { displayName: 'TBD', abbreviation: '' }, score: 0, statistics: [] };
    const homeTeam = safeTeam(home);
    const awayTeam = safeTeam(away);
    const stageName = comp.altGameNote || "FIFA World Cup";
    const matchState = match?.status?.type?.state;
    let clockDisplay = match?.status?.type?.detail || '';
let staticKickoffTime = ''; // Secondary descriptor line

    // FEATURE 1 EXTENSION: Parse and prime target date variables
    if (matchState === "pre" && match.date) {
        const utcKickoff = new Date(match.date);
        staticKickoffTime = utcKickoff.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        clockDisplay = calculateCountdownString(match.date);
    }

    const getMetric = (teamData, field) => {
        if (!teamData.statistics) return 0;
        const statObj = teamData.statistics.find(s => s.name === field);
        return statObj ? parseFloat(statObj.displayValue) : 0;
    };

    const homePoss = getMetric(homeTeam, "possessionPct") || 50;
    const awayPoss = getMetric(awayTeam, "possessionPct") || (100 - homePoss);
    const homeShots = getMetric(homeTeam, "totalShots");
    const awayShots = getMetric(awayTeam, "totalShots");
    const homeSOG = getMetric(homeTeam, "shotsOnTarget");
    const awaySOG = getMetric(awayTeam, "shotsOnTarget");
    const homeCorners = getMetric(homeTeam, "wonCorners");
    const awayCorners = getMetric(awayTeam, "wonCorners");

    const normalizeAbbr = (abbr) => String(abbr || '').toUpperCase();
    const homeColor = FLAG_COLORS[ESPN_TO_ISO[normalizeAbbr(homeTeam.team.abbreviation)]] || '#ffffff';
    const awayColor = FLAG_COLORS[ESPN_TO_ISO[normalizeAbbr(awayTeam.team.abbreviation)]] || '#ffffff';
	
	// FEATURE 4 ADDITION: Localized Color Ambient Bleed Engine
    // Appends a '26' hex alpha value (15% opacity) to keep the background ambient glow elegant
    document.documentElement.style.setProperty('--ambient-home', `${homeColor}26`);
    document.documentElement.style.setProperty('--ambient-away', `${awayColor}26`);

    const calculateRatio = (v1, v2) => {
        if (v1 === 0 && v2 === 0) return 50;
        return (v1 / (v1 + v2)) * 100;
    };

statsContent.innerHTML = `
        <div class="panel-header">
            <div class="stage-title">${escapeHtml(stageName)}</div>
            <div class="match-clock" data-kickoff="${match.date || ''}">${escapeHtml(clockDisplay)}</div>
            ${staticKickoffTime ? `<div class="match-kickoff-static" style="font-size:10px; color:rgba(255,255,255,0.35); margin-top:6px; font-weight:600; letter-spacing:0.5px;">LOCAL: ${escapeHtml(staticKickoffTime)}</div>` : ''}
        </div>
        <div class="panel-scoreboard">
            <div class="panel-team-name" style="color:${homeColor}">${escapeHtml(homeTeam.team.displayName)}</div>
            <div class="panel-score-display">${escapeHtml(homeTeam.score)} : ${escapeHtml(awayTeam.score)}</div>
            <div class="panel-team-name" style="color:${awayColor}">${escapeHtml(awayTeam.team.displayName)}</div>
        </div>
        ${renderStatBar("Possession", escapeHtml(homePoss + "%"), homePoss, escapeHtml(awayPoss + "%"), homeColor, awayColor)}
        ${renderStatBar("Total Shots", escapeHtml(homeShots), calculateRatio(homeShots, awayShots), escapeHtml(awayShots), homeColor, awayColor)}
        ${renderStatBar("Shots on Target", escapeHtml(homeSOG), calculateRatio(homeSOG, awaySOG), escapeHtml(awaySOG), homeColor, awayColor)}
        ${renderStatBar("Corners Won", escapeHtml(homeCorners), calculateRatio(homeCorners, awayCorners), escapeHtml(awayCorners), homeColor, awayColor)}
    `;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
        return ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char];
    });
}

function renderStatBar(title, leftVal, ratio, rightVal, leftColor, rightColor) {
    const normalizedRatio = Number.isFinite(ratio) ? Math.min(100, Math.max(0, ratio)) : 50;
    const secondaryRatio = 100 - normalizedRatio;
    return `
        <div class="stat-row">
            <div class="stat-labels">
                <span>${leftVal}</span> <span class="stat-title">${escapeHtml(title)}</span> <span>${rightVal}</span>
            </div>
            <div class="stat-bar-track">
                <div class="stat-bar-fill" style="width: ${normalizedRatio}%; background: ${leftColor}"></div>
                <div class="stat-bar-fill" style="width: ${secondaryRatio}%; background: ${rightColor || 'rgba(255,255,255,0.08)'}"></div>
            </div>
        </div>
    `;
}

closePanelBtn.addEventListener('click', () => {
    statsPanel.classList.remove('panel-open');
    document.querySelectorAll('.bracket-node').forEach(n => n.classList.remove('selected-view'));
    
    currentlySelectedMatch = null; // Clear active runner tracking loop
    document.documentElement.style.removeProperty('--ambient-home');
    document.documentElement.style.removeProperty('--ambient-away');
});

// ==========================================================================
// FEATURE 4: TAB SWITCH NAVIGATION LAYER & REGISTRATION
// ==========================================================================
const tabMatchStats = document.getElementById('tabMatchStats');
const tabLeaders = document.getElementById('tabLeaders');
const statsContentEl = document.getElementById('statsContent');
const leadersContentEl = document.getElementById('leadersContent');

function switchTabs(targetTab) {
    if (targetTab === 'match') {
        tabMatchStats.classList.add('active');
        tabLeaders.classList.remove('active');
        
        // Show match stats, hide tournament leaders
        statsContentEl.style.display = 'block';
        leadersContentEl.style.display = 'none';
    } else {
        tabMatchStats.classList.remove('active');
        tabLeaders.classList.add('active');
        
        // Hide match stats entirely, show tournament leaders
        statsContentEl.style.display = 'none';
        leadersContentEl.style.display = 'block';
        
        // Instantly renders live calculations compiled from the scoreboard payload
        renderLeadersDashboard();
    }
}

if (tabMatchStats && tabLeaders) {
    tabMatchStats.addEventListener('click', () => switchTabs('match'));
    tabLeaders.addEventListener('click', () => switchTabs('leaders'));
}

// Global Core Tournament Statistics Database Model
const MOCK_LEADERS_DATA = {
    scorers: [
        { rank: 1, name: "Vinícius Júnior", team: "BRA", value: 6 },
        { rank: 2, name: "Jamal Musiala", team: "GER", value: 5 },
        { rank: 3, name: "Kylian Mbappé", team: "FRA", value: 4 },
        { rank: 4, name: "Jude Bellingham", team: "ENG", value: 4 },
        { rank: 5, name: "Lautaro Martínez", team: "ARG", value: 3 }
    ],
    assists: [
        { rank: 1, name: "Florian Wirtz", team: "GER", value: 5 },
        { rank: 2, name: "Kevin De Bruyne", team: "BEL", value: 4 },
        { rank: 3, name: "Lionel Messi", team: "ARG", value: 3 },
        { rank: 4, name: "Nico Williams", team: "ESP", value: 3 },
        { rank: 5, name: "Rafael Leão", team: "POR", value: 3 }
    ]
};

function renderLeadersDashboard() {
    let dashboardHTML = `
        <!-- 4-Column Global Tournament Metrics Grid -->
        <div class="stats-insights-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 15px;">
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 10px 4px; border-radius: 6px; text-align: center;">
                <div style="font-size: 9px; text-transform: uppercase; color: rgba(255,255,255,0.4); font-weight: 700; letter-spacing: 0.5px;">Goals</div>
                <div style="font-size: 16px; font-weight: 800; color: #ffcc00; margin-top: 4px;">${globalTournamentStats.goals || 0}</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 10px 4px; border-radius: 6px; text-align: center;">
                <div style="font-size: 9px; text-transform: uppercase; color: rgba(255,255,255,0.4); font-weight: 700; letter-spacing: 0.5px;">Attendance</div>
                <div style="font-size: 13px; font-weight: 800; color: #ffffff; margin-top: 6px;">${(globalTournamentStats.attendance || 0).toLocaleString()}</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 10px 4px; border-radius: 6px; text-align: center;">
                <div style="font-size: 9px; text-transform: uppercase; color: rgba(255,255,255,0.4); font-weight: 700; letter-spacing: 0.5px;">Shutouts</div>
                <div style="font-size: 16px; font-weight: 800; color: #00f5ff; margin-top: 4px;">${globalTournamentStats.cleanSheets || 0}</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 10px 4px; border-radius: 6px; text-align: center;">
                <div style="font-size: 9px; text-transform: uppercase; color: rgba(255,255,255,0.4); font-weight: 700; letter-spacing: 0.5px;">Reds</div>
                <div style="font-size: 16px; font-weight: 800; color: #ff3b30; margin-top: 4px;">${globalTournamentStats.reds || 0}</div>
            </div>
        </div>

        <!-- Featured High-Scoring Match Banner -->
        <div style="background: linear-gradient(135deg, rgba(212,175,55,0.1), rgba(0,0,0,0.2)); border: 1px solid rgba(212,175,55,0.2); padding: 12px; border-radius: 8px; margin-bottom: 25px; text-align: center;">
            <div style="font-size: 9px; text-transform: uppercase; color: #d4af37; font-weight: 700; letter-spacing: 1.5px; margin-bottom: 4px;">Highest Scoring Match</div>
            <div style="font-size: 13px; font-weight: 700; color: #ffffff;">${escapeHtml(globalTournamentStats.highestScoringMatch)}</div>
        </div>

        <!-- Player Leaderboards -->
        <div class="leaders-section" style="margin-bottom: 25px;">
            <div class="leaders-title">Golden Boot (Goals)</div>
    `;
    
    liveScorers.forEach(p => {
        dashboardHTML += `
            <div class="leader-row">
                <div class="leader-rank">#${p.rank}</div>
                <div class="leader-name">${escapeHtml(p.name)}</div>
                <div class="leader-team">${escapeHtml(p.team)}</div>
                <div class="leader-tally">${p.value}</div>
            </div>
        `;
    });

    dashboardHTML += `
        </div>
        <div class="leaders-section" style="margin-bottom: 25px;">
            <div class="leaders-title">Top Playmaking Teams (Assists)</div>
    `;

    liveAssistsTeams.forEach(t => {
        dashboardHTML += `
            <div class="leader-row">
                <div class="leader-rank">#${t.rank}</div>
                <div class="leader-name">${escapeHtml(t.name)}</div>
                <div class="leader-team">${escapeHtml(t.team)}</div>
                <div class="leader-tally">${t.value}</div>
            </div>
        `;
    });

    dashboardHTML += `
        </div>
        <div class="leaders-section">
            <div class="leaders-title">Aggression Index (Cards Weight)</div>
    `;

    liveDirtyTeams.forEach(t => {
        dashboardHTML += `
            <div class="leader-row">
                <div class="leader-rank">#${t.rank}</div>
                <div class="leader-name">${escapeHtml(t.name)}</div>
                <div class="leader-team">${escapeHtml(t.team)}</div>
                <div class="leader-tally" style="color: #ffcc00">${t.value}</div>
            </div>
        `;
    });

    dashboardHTML += `</div>`;
    leadersContentEl.innerHTML = dashboardHTML;
}

// 1. Parses individual player goals from the match events details timeline
function computeLiveScorers(events) {
    const scorerMap = {};

    events.forEach(evt => {
        const competitors = evt?.competitions?.[0]?.competitors || [];
        const details = evt?.competitions?.[0]?.details || [];

        details.forEach(detail => {
            const typeText = String(detail?.type?.text || '').toLowerCase();
            const isGoal = typeText.includes('goal') || typeText.includes('penalty - scored');
            const isOwnGoal = detail?.ownGoal === true;
            const isShootout = detail?.shootout === true;

            // Only count real goals scored during regular or extra time
            if (isGoal && !isOwnGoal && !isShootout) {
                const athlete = detail?.athletesInvolved?.[0];
                const teamId = detail?.team?.id || athlete?.team?.id;
                
                if (athlete && athlete.displayName) {
                    const playerName = athlete.displayName;

                    // Resolve the team's 3-letter abbreviation from competitors
                    let teamAbbr = "TBD";
                    const matchingComp = competitors.find(c => String(c.id) === String(teamId));
                    if (matchingComp && matchingComp.team) {
                        teamAbbr = matchingComp.team.abbreviation || "TBD";
                    }

                    if (!scorerMap[playerName]) {
                        scorerMap[playerName] = { name: playerName, team: teamAbbr.toUpperCase(), goals: 0 };
                    }
                    scorerMap[playerName].goals += 1;
                }
            }
        });
    });

    // Convert map to array, sort descending by goals, and take the top 5
    return Object.values(scorerMap)
        .sort((a, b) => b.goals - a.goals)
        .slice(0, 5)
        .map((player, idx) => ({
            rank: idx + 1,
            name: player.name,
            team: player.team,
            value: player.goals
        }));
}

// 2. Aggregates team-level assists from the competitors match stats
function computeLiveTeamAssists(events) {
    const teamAssistMap = {};

    events.forEach(evt => {
        const competitors = evt?.competitions?.[0]?.competitors || [];
        
        competitors.forEach(comp => {
            if (comp.team && comp.statistics) {
                const teamName = comp.team.displayName || "Unknown Team";
                const teamAbbr = (comp.team.abbreviation || "TBD").toUpperCase();
                
                // Locate the goalAssists property inside the statistics array
                const assistStat = comp.statistics.find(s => s.name === "goalAssists");
                const assistsInMatch = assistStat ? parseInt(assistStat.displayValue) || 0 : 0;

                if (!teamAssistMap[teamAbbr]) {
                    teamAssistMap[teamAbbr] = { name: teamName, abbr: teamAbbr, assists: 0 };
                }
                teamAssistMap[teamAbbr].assists += assistsInMatch;
            }
        });
    });

    // Convert map to array, sort descending by total assists, and take the top 5
    return Object.values(teamAssistMap)
        .sort((a, b) => b.assists - a.assists)
        .slice(0, 5)
        .map((team, idx) => ({
            rank: idx + 1,
            name: team.name,
            team: team.abbr,
            value: team.assists
        }));
}

function computeGlobalTournamentStats(events) {
    let totalGoals = 0;
    let totalAttendance = 0;
    let totalReds = 0;
    let totalCleanSheets = 0;
    
    let highestMatchScore = -1;
    let highestScoringMatchStr = "No games recorded";

    events.forEach(evt => {
        const comp = evt?.competitions?.[0];
        if (!comp) return;

        // 1. Attendance Accumulation
        if (comp.attendance && Number.isFinite(comp.attendance)) {
            totalAttendance += comp.attendance;
        }

        const competitors = comp.competitors || [];
        if (competitors.length >= 2) {
            const score0 = parseInt(competitors[0].score) || 0;
            const score1 = parseInt(competitors[1].score) || 0;
            const combinedScore = score0 + score1;
            
            // Tally goals
            totalGoals += combinedScore;

            // 2. Clean Sheets Tally (Any team holding opponent to 0)
            if (score0 === 0) totalCleanSheets++;
            if (score1 === 0) totalCleanSheets++;

            // 3. Highest Scoring Match Evaluator
            if (combinedScore > highestMatchScore) {
                highestMatchScore = combinedScore;
                const team0 = competitors[0]?.team?.displayName || "TBD";
                const team1 = competitors[1]?.team?.displayName || "TBD";
                highestScoringMatchStr = `${team0} ${score0} : ${score1} ${team1}`;
            }
        }

        // 4. Red Cards Tally
        const details = comp.details || [];
        details.forEach(detail => {
            if (detail?.redCard === true || String(detail?.type?.text).toLowerCase() === 'red card') {
                totalReds++;
            }
        });
    });

    return {
        goals: totalGoals,
        attendance: totalAttendance,
        reds: totalReds,
        cleanSheets: totalCleanSheets,
        highestScoringMatch: highestScoringMatchStr
    };
}

function computeLiveDisciplinaryTeams(events) {
    const cardMap = {};

    events.forEach(evt => {
        const competitors = evt?.competitions?.[0]?.competitors || [];
        const details = evt?.competitions?.[0]?.details || [];

        details.forEach(detail => {
            const typeText = String(detail?.type?.text || '').toLowerCase();
            const isYellow = typeText.includes('yellow');
            const isRed = typeText.includes('red') || detail?.redCard === true;

            if (isYellow || isRed) {
                const teamId = detail?.team?.id;
                let teamAbbr = "TBD";
                let teamName = "Unknown";

                const matchingComp = competitors.find(c => String(c.id) === String(teamId));
                if (matchingComp && matchingComp.team) {
                    teamAbbr = (matchingComp.team.abbreviation || "TBD").toUpperCase();
                    teamName = matchingComp.team.displayName || "Unknown Team";
                }

                if (teamAbbr !== "TBD") {
                    if (!cardMap[teamAbbr]) {
                        cardMap[teamAbbr] = { name: teamName, abbr: teamAbbr, points: 0 };
                    }
                    cardMap[teamAbbr].points += isRed ? 3 : 1;
                }
            }
        });
    });

    return Object.values(cardMap)
        .sort((a, b) => b.points - a.points)
        .slice(0, 5)
        .map((team, idx) => ({
            rank: idx + 1,
            name: team.name,
            team: team.abbr,
            value: `${team.points} pts`
        }));
};

function drawCanvasContext() {
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
    const effectiveAudioBass = settings.audioReactive ? Math.min(1, Math.max(0, audioBass)) : 0;

    for (let round = 0; round < TOTAL_ROUNDS - 1; round++) {
        const currentRadius = (RADII_PROPORTIONS[round] / 100) * cachedBaseRadius;
        const nextRadius = (RADII_PROPORTIONS[round + 1] / 100) * cachedBaseRadius;
        const midRadius = (currentRadius + nextRadius) / 2;

        bracketTree[round].forEach((node, index) => {
            const parentIndex = Math.floor(index / 2);
            const parentNode = bracketTree[round + 1][parentIndex];

            let points = [{ x: node.x, y: node.y }];
            const midX1 = cachedCx + midRadius * Math.cos(node.angle + globalRotation);
            const midY1 = cachedCy + midRadius * Math.sin(node.angle + globalRotation);
            points.push({ x: midX1, y: midY1 });

            const steps = 12; 
            for (let s = 1; s <= steps; s++) {
                const interpolatedAngle = (node.angle + globalRotation) + (parentNode.angle - node.angle) * (s / steps);
                const arcX = cachedCx + midRadius * Math.cos(interpolatedAngle);
                const arcY = cachedCy + midRadius * Math.sin(interpolatedAngle);
                points.push({ x: arcX, y: arcY });
            }
            points.push({ x: parentNode.x, y: parentNode.y });

            const isWinnerTrack = (!node.isEmpty && parentNode.label === node.label);
            const isHoveredTrack = (hoveredTeam && node.label === hoveredTeam && parentNode.label === hoveredTeam);

            // 1. Structural Bracket Custom Styling Rules
            if (isHoveredTrack) {
                const teamColor = FLAG_COLORS[node.label] || '#ffffff';
                ctx.strokeStyle = teamColor;
                ctx.lineWidth = settings.winnerLineBase + 3.5 + (effectiveAudioBass * settings.glowIntensity * 2.0);
                ctx.shadowColor = teamColor;
                ctx.shadowBlur = 20 + (effectiveAudioBass * settings.glowIntensity * 10);
            } else if (isWinnerTrack) {
                const teamColor = FLAG_COLORS[node.label] || '#d4af37';
                ctx.strokeStyle = teamColor;
                ctx.lineWidth = settings.winnerLineBase + (effectiveAudioBass * settings.glowIntensity * 2.0);
                ctx.shadowColor = teamColor;
                ctx.shadowBlur = 8 + (effectiveAudioBass * settings.glowIntensity * 18);
            } else if (node.isLive) {
                const liveGradient = ctx.createRadialGradient(
                    cachedCx, cachedCy, currentRadius,
                    cachedCx, cachedCy, nextRadius
                );
                
                liveGradient.addColorStop(0, '#00f5ff');   
                liveGradient.addColorStop(0.5, '#ff007f'); 
                liveGradient.addColorStop(1, '#ffcc00');   
                
                ctx.strokeStyle = liveGradient; 
                ctx.lineWidth = 3.0 + (effectiveAudioBass * settings.glowIntensity * 4);
                
                ctx.shadowColor = '#ff007f'; 
                ctx.shadowBlur = 10 + (effectiveAudioBass * settings.glowIntensity * 12);
            } else {
                const distanceFromCenter = (TOTAL_ROUNDS - 1) - round;
                const baseGrid = settings.gridColor;
                const gold = { r: 212, g: 175, b: 55 };
                const glowFade = Math.max(0, Math.min(1, (3 - distanceFromCenter) / 2));
                const blend = (valueA, valueB) => Math.round(valueA * glowFade + valueB * (1 - glowFade));
                const blendedR = blend(gold.r, baseGrid.r);
                const blendedG = blend(gold.g, baseGrid.g);
                const blendedB = blend(gold.b, baseGrid.b);
                const alpha = 0.12 + glowFade * 0.28 + effectiveAudioBass * 0.05;
                ctx.strokeStyle = `rgba(${blendedR}, ${blendedG}, ${blendedB}, ${Math.min(alpha, 0.35)})`;
                ctx.lineWidth = 1.0 + glowFade * 0.25 + (effectiveAudioBass * settings.glowIntensity * 0.65);
                ctx.shadowBlur = glowFade > 0 ? 2 + (effectiveAudioBass * 6) : 0;
                ctx.shadowColor = `rgba(212, 175, 55, ${0.15 + glowFade * 0.35})`;
            }

            let currentLineProgress = 1;
            if (isLoadAnimating && isWinnerTrack) {
                currentLineProgress = getRoundProgress(round);
            }

            // 2. Compute Segment Path Architecture
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            let totalSegments = points.length - 1;
            let targetSegmentCount = totalSegments * currentLineProgress;
            
            for (let s = 1; s <= totalSegments; s++) {
                if (s <= targetSegmentCount) {
                    ctx.lineTo(points[s].x, points[s].y);
                } else {
                    let remainder = targetSegmentCount - (s - 1);
                    if (remainder > 0) {
                        let prevP = points[s - 1]; let currP = points[s];
                        ctx.lineTo(prevP.x + (currP.x - prevP.x) * remainder, prevP.y + (currP.y - prevP.y) * remainder);
                    }
                    break;
                }
            }
            
            ctx.stroke();

            // 3. Render Kinetic Energy Streams: Fiber-Optic Plasma Implementation
            if ((isWinnerTrack || isHoveredTrack) && !isLoadAnimating) {
                ctx.save();
                const teamColor = FLAG_COLORS[node.label] || '#d4af37';
                
                ctx.globalCompositeOperation = 'lighter'; 
                ctx.strokeStyle = teamColor;
                ctx.lineWidth = settings.winnerLineBase + 0.8;
                
                ctx.setLineDash([14, 48]); 
                ctx.lineDashOffset = -globalRotation * 280; 
                
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = isHoveredTrack ? 14 : 8;
                
                ctx.stroke(); 
                ctx.restore(); 
            }
        });
    }

    // 4. FEATURE 5 ADDITION: Concentric Sonar Shockwaves Execution Layer
    if (settings.audioReactive && shockwaves.length > 0) {
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const wave = shockwaves[i];
            
            // Adjust execution rates to modify pulse speed and fade timing
            wave.radius += cachedBaseRadius * 0.006; 
            wave.alpha -= 0.012; 

            if (wave.alpha <= 0 || wave.radius >= wave.maxRadius) {
                shockwaves.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.beginPath();
            // Static concentric arc centered cleanly around the chassis axis
            ctx.arc(cachedCx, cachedCy, wave.radius, 0, Math.PI * 2);
            
            ctx.strokeStyle = `rgba(212, 175, 55, ${wave.alpha * settings.glowIntensity})`;
            ctx.lineWidth = 1.0 + (effectiveAudioBass * 2.5);
            ctx.shadowColor = 'rgba(212, 175, 55, 0.4)';
            ctx.shadowBlur = 12 * wave.alpha;
            
            ctx.stroke();
            ctx.restore();
        }
    }

    particles.forEach(p => p.draw(ctx));
}

function animateLoadLoop() {
    if (loadProgress >= 1) {
        loadProgress = 1; isLoadAnimating = false;
        handleDisplayResize(); 
        masterDriverOrbitLoop(); 
        return; 
    }
    // Changed from 0.004 to 0.0055 for a crisper, high-energy opening sequence
    loadProgress += 0.0055; 
    masterDriverOrbitLoop();
}

function masterDriverOrbitLoop() {
    // 1. Kinetic Momentum Physics Calculation Engine
    if (isDragging) {
        // Position is completely bound to user tracking coordinates via event hooks
    } else {
        if (Math.abs(angularVelocity) > 0.00005) {
            // Smoothly progress rotation position using momentum calculations (~16.67ms frames)
            globalRotation += angularVelocity * 16.67;
            
            // Friction/Damping coefficient. 0.96 means the wheel loses 4% speed per frame
            angularVelocity *= 0.96; 
        } else {
            // When kinetic velocity completely de-energizes, seamlessly return to ambient rotation
            globalRotation = (globalRotation + ROTATION_SPEED) % (Math.PI * 2);
        }
    }
    
    syncLayoutPositions();
	
    if (currentlySelectedMatch && !isLoadAnimating) {
        countdownFrameCounter++;
        if (countdownFrameCounter >= 60) { 
            countdownFrameCounter = 0;
            updateLiveCountdowns();
        }
    }

    if (particles.length > 0) {
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update();
            if (particles[i].alpha <= 0) {
                particles.splice(i, 1);
            }
        }
    }
    
    drawCanvasContext();
    
    if (!isLoadAnimating) {
        requestAnimationFrame(masterDriverOrbitLoop);
    } else {
        requestAnimationFrame(animateLoadLoop);
    }
}

function triggerParticleBlast(x, y, color) {
    for (let i = 0; i < 65; i++) {
        particles.push(new SparkParticle(x, y, color));
    }
}

function handleDisplayResize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    cachedCx = container.clientWidth / 2;
    cachedCy = container.clientHeight / 2;
    cachedBaseRadius = Math.min(container.clientWidth, container.clientHeight);
    
    syncLayoutPositions(); 
    drawCanvasContext();
}

if (window.wallpaperRegisterAudioListener) {
    window.wallpaperRegisterAudioListener((audioArray) => {
        if (!Array.isArray(audioArray) || audioArray.length < 68) return;
        const bassLeft = (audioArray[0] + audioArray[1] + audioArray[2] + audioArray[3]) / 4;
        const bassRight = (audioArray[64] + audioArray[65] + audioArray[66] + audioArray[67]) / 4;
        audioBass = (bassLeft + bassRight) / 2;
        const effectiveAudioBass = settings.audioReactive ? audioBass : 0;

        // FEATURE 5 ADDITION: Shockwave Spawn Logic
        if (settings.audioReactive && audioBass > 0.82) {
            // Prevent frame-flooding by forcing a structural separation distance between rings
            if (shockwaves.length === 0 || shockwaves[shockwaves.length - 1].radius > (cachedBaseRadius * 0.12)) {
                shockwaves.push({
                    radius: cachedBaseRadius * 0.04,
                    alpha: 0.45,
                    maxRadius: cachedBaseRadius * 0.48
                });
            }
        }

        const centerGlow = document.querySelector('.center-glow');
        if (centerGlow) {
            if (settings.showCenterGlow) {
                centerGlow.style.display = '';
                centerGlow.style.transform = `translate(-50%, -50%) scale(${1 + effectiveAudioBass * 0.35 * settings.glowIntensity})`;
                centerGlow.style.opacity = 0.6 + effectiveAudioBass * 0.4 * settings.glowIntensity;
            } else {
                centerGlow.style.display = 'none';
            }
        }

        const centerTrophy = document.getElementById('centerTrophy');
        if (centerTrophy) {
            centerTrophy.style.transform = `translate(-50%, -50%) scale(${1 + effectiveAudioBass * 0.12 * settings.glowIntensity})`;
        }
    });
}

window.wallpaperPropertyListener = {
    applyUserProperties: function(properties) {
        if (!properties) return;
        if (properties.rotationSpeed && properties.rotationSpeed.value !== undefined) {
            const parsedSpeed = Number(properties.rotationSpeed.value);
            if (Number.isFinite(parsedSpeed)) {
                ROTATION_SPEED = parsedSpeed;
                settings.rotationSpeed = ROTATION_SPEED;
            }
        }
        if (properties.glowIntensity && properties.glowIntensity.value !== undefined) {
            const parsedGlow = Number(properties.glowIntensity.value);
            if (Number.isFinite(parsedGlow)) {
                settings.glowIntensity = parsedGlow;
            }
        }
        if (properties.showCenterGlow && properties.showCenterGlow.value !== undefined) {
            settings.showCenterGlow = !!properties.showCenterGlow.value;
            const centerGlow = document.querySelector('.center-glow');
            if (centerGlow) centerGlow.style.display = settings.showCenterGlow ? '' : 'none';
        }
        if (properties.audioReactive && properties.audioReactive.value !== undefined) {
            settings.audioReactive = !!properties.audioReactive.value;
        }
        if (properties.schemecolor) {
            const parsedColor = parseWallpaperColor(properties.schemecolor);
            if (parsedColor) {
                settings.backgroundColor = parsedColor;
                document.body.style.backgroundColor = `rgb(${parsedColor.r}, ${parsedColor.g}, ${parsedColor.b})`;
            }
        }
        if (properties.gridColor) {
            const parsedGridColor = parseWallpaperColor(properties.gridColor);
            if (parsedGridColor) {
                settings.gridColor = parsedGridColor;
            }
        }

        syncLayoutPositions();
        drawCanvasContext();
    }
};

buildTreeStructure();
refreshNodeDOMStructures(); 
handleDisplayResize();
fetchAndApplyLiveScores();

setInterval(fetchAndApplyLiveScores, 5 * 60 * 1000);

// HARDENED GLOBAL VIEWPORT STABILIZATION LAYER
let resizeDebounceTimeout;
function unifiedDeviceViewportSync() {
    clearTimeout(resizeDebounceTimeout);
    resizeDebounceTimeout = setTimeout(() => {
        handleDisplayResize();
    }, 80);
}

// ==========================================================================
// KINETIC MOMENTUM WHEEL: COORDINATE TRACKING PIPELINE
// ==========================================================================
const getPointerAngle = (clientX, clientY) => {
    return Math.atan2(clientY - cachedCy, clientX - cachedCx);
};

container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    
    // SAFEGUARD: If the user clicks inside the stats panel or tabs, 
    // do not trigger the global wheel dragging mechanism.
    if (e.target.closest('#statsPanel')) return;

    isDragging = true;
    hasDraggedSignificant = false;
    
    const currentAngle = getPointerAngle(e.clientX, e.clientY);
    dragStartAngle = currentAngle;
    dragStartRotation = globalRotation;
    
    lastPointerAngle = currentAngle;
    lastPointerTime = performance.now();
    angularVelocity = 0; 
});

window.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    
    // SAFEGUARD: If the move path clips into the stats panel bounds, 
    // kill the wheel drag state to preserve text scrolling freedom.
    if (e.target.closest('#statsPanel')) {
        isDragging = false;
        return;
    }

    const currentAngle = getPointerAngle(e.clientX, e.clientY);
    const now = performance.now();
    const deltaTime = now - lastPointerTime;

    let deltaAngle = currentAngle - lastPointerAngle;
    if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
    if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

    if (Math.abs(currentAngle - dragStartAngle) > 0.03) {
        hasDraggedSignificant = true;
    }

    globalRotation += deltaAngle;

    if (deltaTime > 0) {
        angularVelocity = deltaAngle / deltaTime;
    }

    lastPointerAngle = currentAngle;
    lastPointerTime = now;
});

window.addEventListener('pointerup', () => {
    if (!isDragging) return;
    isDragging = false;
    
    // If the user holds the pointer completely still before releasing, kill the spin force
    if (performance.now() - lastPointerTime > 80) {
        angularVelocity = 0;
    }
});

window.addEventListener('pointercancel', () => {
    isDragging = false;
    angularVelocity = 0;
});

// FIXED: Removed duplicate standalone listener that was causing competing callbacks
window.addEventListener('resize', unifiedDeviceViewportSync);
window.addEventListener('orientationchange', unifiedDeviceViewportSync);

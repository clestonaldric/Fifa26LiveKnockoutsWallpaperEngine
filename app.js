const canvas = document.getElementById('bracketCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('nodesOverlay');
const statsPanel = document.getElementById('statsPanel');
const statsContent = document.getElementById('statsContent');
const closePanelBtn = document.getElementById('closePanelBtn');

// Define concentric track radii proportions (measured in % of viewport height/width minimum)
const RADII_PROPORTIONS = [42, 32, 23, 14, 7]; 
const TOTAL_ROUNDS = 5; 

let bracketTree = [];
let particles = [];
let isAnimationLoopActive = false;

// Global dimension caching properties to stop frame dropping and layout thrashing
let cachedCx = 0;
let cachedCy = 0;
let cachedBaseRadius = 0;

// Hardware Accelerated Rotation Variables
let globalRotation = 0;
let ROTATION_SPEED = 0.0012; 

// User-customisable settings (Wallpaper Engine will call applyUserProperties)
const settings = {
    rotationSpeed: ROTATION_SPEED,
    glowIntensity: 1.0,
    showCenterGlow: true,
    audioReactive: true,
    gridColor: { r: 212, g: 175, b: 55 },
    backgroundColor: { r: 8, g: 8, b: 8 },
    winnerLineBase: 2.0,
    nonWinnerAlphaBase: 0.45
};

function parseWallpaperColor(property) {
    if (!property) return null;
    const color = property.color || property.value || property;
    if (!color) return null;
    if (typeof color === 'string') {
        const hex = color.replace('#', '').trim();
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16)
            };
        }
        const parts = color.split(/[^0-9]+/).filter(Boolean).map(Number);
        if (parts.length >= 3) {
            return { r: parts[0], g: parts[1], b: parts[2] };
        }
    }
    if (Array.isArray(color) && color.length >= 3) {
        return { r: Number(color[0]), g: Number(color[1]), b: Number(color[2]) };
    }
    if (typeof color === 'object' && color.r !== undefined && color.g !== undefined && color.b !== undefined) {
        return { r: Number(color.r), g: Number(color.g), b: Number(color.b) };
    }
    return null;
}

// Audio Responsiveness and Intro Animation Lifecycle Controllers
let audioBass = 0;
let loadProgress = 0;
let isLoadAnimating = true;

// Change this section in your app.js
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
                const rotationOffset = (45 * Math.PI) / 180; // FIXED: Aligned perfectly to clean 45-degree corner axes
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
    const roundDuration = 1 / (TOTAL_ROUNDS - 1);
    const startPct = round * roundDuration;
    const progress = (loadProgress - startPct) / roundDuration;
    return Math.max(0, Math.min(1, progress));
}

async function fetchAndApplyLiveScores() {
    try {
        // Fetch real-time data directly from the live ESPN scoreboard endpoint
        const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260720');
        const data = await response.json();
        if (!data.events) return;

        // Reset live-status flags across all nodes before processing fresh updates
        for (let round = 0; round < TOTAL_ROUNDS; round++) {
            bracketTree[round].forEach(node => { 
                node.isLive = false; 
                node.matchDataRef = null; 
            });
        }

        // Parse matches and map advancing winners/live score differentials dynamically
        for (let round = 1; round < TOTAL_ROUNDS; round++) {
            const teamsInRound = 32 / Math.pow(2, round);
            for (let i = 0; i < teamsInRound; i++) {
                const child1 = bracketTree[round - 1][i * 2];
                const child2 = bracketTree[round - 1][i * 2 + 1];

                if (!child1.isEmpty && !child2.isEmpty) {
                    const match = data.events.find(evt => {
                        const comps = evt.competitions[0].competitors;
                        if (!comps[0] || !comps[1]) return false;
                        const t1 = ESPN_TO_ISO[comps[0].team.abbreviation];
                        const t2 = ESPN_TO_ISO[comps[1].team.abbreviation];
						return (t1 === child1.label && t2 === child2.label) || (t1 === child2.label && t2 === child1.label);
                    });

                    if (match) {
                        const competitors = match.competitions[0].competitors;
                        const matchState = match.status.type.state; 

                        child1.matchDataRef = match;
                        child2.matchDataRef = match;

                        if (matchState === "in") {
                            child1.isLive = true; child2.isLive = true;
                            const c1Data = competitors.find(c => ESPN_TO_ISO[c.team.abbreviation] === child1.label);
                            const c2Data = competitors.find(c => ESPN_TO_ISO[c.team.abbreviation] === child2.label);

                            if (c1Data && c2Data) {
                                const currentScore1 = parseInt(c1Data.score) || 0;
                                const currentScore2 = parseInt(c2Data.score) || 0;

                                // If a score increases while live, trigger particle bursts
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
        
        syncLayoutPositions();
        drawCanvasContext();

        if (isLoadAnimating && loadProgress === 0) {
            animateLoadLoop();
        }

    } catch (error) {
        console.error("ESPN Query processing failure:", error);
    }
}

function syncLayoutPositions() {
    for (let round = 0; round < TOTAL_ROUNDS; round++) {
        const radiusPx = (RADII_PROPORTIONS[round] / 100) * cachedBaseRadius;
        
        bracketTree[round].forEach((node, index) => {
            let finalAngle = node.angle + globalRotation;
            
            const offsetX = radiusPx * Math.cos(finalAngle);
            const offsetY = radiusPx * Math.sin(finalAngle);
            node.x = cachedCx + offsetX;
            node.y = cachedCy + offsetY;

            let nodeDOM = document.getElementById(`node-${round}-${index}`);
            if (!nodeDOM) {
                nodeDOM = document.createElement('div');
                nodeDOM.id = `node-${round}-${index}`;
                nodeDOM.addEventListener('click', () => handleNodeClickEvent(nodeDOM, node));
                container.appendChild(nodeDOM);
            }

            let stateClass = 'empty';
            if (!node.isEmpty) stateClass = 'advanced';
            if (node.isLoser) stateClass = 'loser';
            if (node.isLive) stateClass += ' live-pulse';
            if (nodeDOM.classList.contains('selected-view')) stateClass += ' selected-view';

            nodeDOM.className = `bracket-node round-${round} ${stateClass}`;
            
            if (node.isEmpty) {
                nodeDOM.innerHTML = ""; 
            } else {
                let scoreOverlay = "";
                if (node.isLive && node.score !== undefined) {
                    scoreOverlay = `<span class="live-score-badge">${node.score}</span>`;
                }

                nodeDOM.innerHTML = `
                    <img src="https://flagcdn.com/w160/${node.label}.png" class="flag-img" alt="${node.label}">
                    ${scoreOverlay}
                `;
            }

            // FIXED: Leverages absolute translate3d hardware composition mapping to eliminate rotation lag entirely
            let transformString = `translate3d(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px), 0)`;
            if (nodeDOM.classList.contains('selected-view')) {
                transformString += ` scale(1.12)`;
            } else if (round > 0) {
                let currentRingOpacity = getRoundProgress(round - 1);
                nodeDOM.style.opacity = currentRingOpacity;
                transformString += ` scale(${0.7 + currentRingOpacity * 0.3})`;
            } else {
                nodeDOM.style.opacity = 1;
            }
            nodeDOM.style.transform = transformString;
        });
    }
}

function handleNodeClickEvent(element, node) {
    if (!node.matchDataRef) return; 
    document.querySelectorAll('.bracket-node').forEach(n => n.classList.remove('selected-view'));
    element.classList.add('selected-view');
    updateStatsPanelUI(node.matchDataRef);
    statsPanel.classList.add('panel-open');
}

function updateStatsPanelUI(match) {
    if (!match) return;

    const comp = match.competitions[0];
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    const stageName = comp.altGameNote || "FIFA World Cup";
    // 1. Get the current match state ("pre" = scheduled, "in" = live, "post" = finished)
    const matchState = match.status.type.state;
    let clockDisplay = match.status.type.detail;

    // 2. If the match hasn't started yet, convert ESPN's UTC string to local device time
    if (matchState === "pre" && match.date) {
        const utcKickoff = new Date(match.date);
        
        // Formats dynamically to the viewer's regional settings (e.g., "Jul 6, 8:30 PM EDT")
        clockDisplay = utcKickoff.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'long' // Appends the local zone 
        });
    }

    const getMetric = (teamData, field) => {
        if (!teamData.statistics) return 0;
        const statObj = teamData.statistics.find(s => s.name === field);
        return statObj ? parseFloat(statObj.displayValue) : 0;
    };

    const homePoss = getMetric(home, "possessionPct") || 50;
    const awayPoss = getMetric(away, "possessionPct") || (100 - homePoss);
    const homeShots = getMetric(home, "totalShots");
    const awayShots = getMetric(away, "totalShots");
    const homeSOG = getMetric(home, "shotsOnTarget");
    const awaySOG = getMetric(away, "shotsOnTarget");
    const homeCorners = getMetric(home, "wonCorners");
    const awayCorners = getMetric(away, "wonCorners");

    const calculateRatio = (v1, v2) => {
        if (v1 === 0 && v2 === 0) return 50;
        return (v1 / (v1 + v2)) * 100;
    };

    const homeColor = FLAG_COLORS[ESPN_TO_ISO[home.team.abbreviation]] || '#ffffff';
    const awayColor = FLAG_COLORS[ESPN_TO_ISO[away.team.abbreviation]] || '#ffffff';

    statsContent.innerHTML = `
        <div class="panel-header">
            <div class="stage-title">${stageName}</div>
            <div class="match-clock">${clockDisplay}</div>
        </div>
        <div class="panel-scoreboard">
            <div class="panel-team-name" style="color:${homeColor}">${home.team.displayName}</div>
            <div class="panel-score-display">${home.score} : ${away.score}</div>
            <div class="panel-team-name" style="color:${awayColor}">${away.team.displayName}</div>
        </div>
        ${renderStatBar("Possession", homePoss + "%", homePoss, awayPoss + "%", homeColor, awayColor)}
        ${renderStatBar("Total Shots", homeShots, calculateRatio(homeShots, awayShots), awayShots, homeColor, awayColor)}
        ${renderStatBar("Shots on Target", homeSOG, calculateRatio(homeSOG, awaySOG), awaySOG, homeColor, awayColor)}
        ${renderStatBar("Corners Won", homeCorners, calculateRatio(homeCorners, awayCorners), awayCorners, homeColor, awayColor)}
    `;
}

function renderStatBar(title, leftVal, ratio, rightVal, leftColor, rightColor) {
    return `
        <div class="stat-row">
            <div class="stat-labels">
                <span>${leftVal}</span> <span class="stat-title">${title}</span> <span>${rightVal}</span>
            </div>
            <div class="stat-bar-track">
                <div class="stat-bar-fill" style="width: ${ratio}%; background: ${leftColor}"></div>
                <div class="stat-bar-fill" style="width: ${100 - ratio}%; background: ${rightColor || 'rgba(255,255,255,0.08)'}"></div>
            </div>
        </div>
    `;
}

closePanelBtn.addEventListener('click', () => {
    statsPanel.classList.remove('panel-open');
    document.querySelectorAll('.bracket-node').forEach(n => n.classList.remove('selected-view'));
});

function drawCanvasContext() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const effectiveAudioBass = settings.audioReactive ? audioBass : 0;

    // Draw radial tracks between nodes with audio-driven glow (matches working version)
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

                    if (isWinnerTrack) {
                        const teamColor = FLAG_COLORS[node.label] || '#d4af37';
                        ctx.strokeStyle = teamColor;
                        ctx.lineWidth = settings.winnerLineBase + (effectiveAudioBass * settings.glowIntensity * 2.0);
                        ctx.shadowColor = teamColor;
                        ctx.shadowBlur = 8 + (effectiveAudioBass * settings.glowIntensity * 18);
                    } else if (node.isLive) {
                        ctx.strokeStyle = '#00bfff'; 
                        ctx.lineWidth = 2.5 + (effectiveAudioBass * settings.glowIntensity * 4);
                        ctx.shadowColor = '#00bfff'; 
                        ctx.shadowBlur = 8 + (effectiveAudioBass * settings.glowIntensity * 12);
                    } else {
                        // Gold-colored grid lines (non-winner)
                        const gc = settings.gridColor;
                        ctx.strokeStyle = `rgba(${gc.r}, ${gc.g}, ${gc.b}, ${settings.nonWinnerAlphaBase + effectiveAudioBass * 0.25 * settings.glowIntensity})`;
                        ctx.lineWidth = 1.2 + (effectiveAudioBass * settings.glowIntensity * 0.9);
                        ctx.shadowBlur = 0 + (effectiveAudioBass * settings.glowIntensity * 6);
                        ctx.shadowColor = `rgba(${gc.r}, ${gc.g}, ${gc.b}, 0.9)`;
                    }

            let currentLineProgress = 1;
            if (isLoadAnimating && isWinnerTrack) {
                currentLineProgress = getRoundProgress(round);
            }

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
        });
    }

    particles.forEach(p => p.draw(ctx));
}

function animateLoadLoop() {
    if (loadProgress >= 1) {
        loadProgress = 1; isLoadAnimating = false;
        handleDisplayResize(); masterDriverOrbitLoop(); 
        return; 
    }
    loadProgress += 0.004; masterDriverOrbitLoop();
}

function masterDriverOrbitLoop() {
    if (!isLoadAnimating) {
        globalRotation += ROTATION_SPEED;
    }
    syncLayoutPositions();
    if (!isAnimationLoopActive) {
        drawCanvasContext();
    }
    if (!isLoadAnimating) {
        requestAnimationFrame(masterDriverOrbitLoop);
    } else {
        requestAnimationFrame(animateLoadLoop);
    }
}

function triggerParticleBlast(x, y, color) {
    for (let i = 0; i < 65; i++) particles.push(new SparkParticle(x, y, color));
    if (!isAnimationLoopActive) { isAnimationLoopActive = true; animateFrameLoop(); }
}

function animateFrameLoop() {
    if (particles.length === 0) { isAnimationLoopActive = false; drawCanvasContext(); return; }
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].alpha <= 0) particles.splice(i, 1);
    }
    drawCanvasContext();
    requestAnimationFrame(animateFrameLoop);
}

function handleDisplayResize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    
    cachedCx = container.clientWidth / 2;
    cachedCy = container.clientHeight / 2;
    cachedBaseRadius = Math.min(container.clientWidth, container.clientHeight);
    
    syncLayoutPositions(); 
    drawCanvasContext();
}

// Wallpaper Engine audio listener integration (if available)
if (window.wallpaperRegisterAudioListener) {
    window.wallpaperRegisterAudioListener((audioArray) => {
        // compute bass energy
        const bassLeft = (audioArray[0] + audioArray[1] + audioArray[2] + audioArray[3]) / 4;
        const bassRight = (audioArray[64] + audioArray[65] + audioArray[66] + audioArray[67]) / 4;
        audioBass = (bassLeft + bassRight) / 2;
        const effectiveAudioBass = settings.audioReactive ? audioBass : 0;

        const centerGlow = document.querySelector('.center-glow');
        if (centerGlow) {
            if (settings.showCenterGlow) {
                centerGlow.style.display = '';
                centerGlow.style.transform = `scale(${1 + effectiveAudioBass * 0.35 * settings.glowIntensity})`;
                centerGlow.style.opacity = 0.6 + effectiveAudioBass * 0.4 * settings.glowIntensity;
            } else {
                centerGlow.style.display = 'none';
            }
        }

        const centerTrophy = document.getElementById('centerTrophy');
        if (centerTrophy) {
            centerTrophy.style.transform = `translate(-50%, -50%) scale(${1 + effectiveAudioBass * 0.12 * settings.glowIntensity})`;
        }

        if (!isAnimationLoopActive && !isLoadAnimating) {
            drawCanvasContext();
        }
    });
}

// Wallpaper Engine property listener for user customizations
window.wallpaperPropertyListener = {
    applyUserProperties: function(properties) {
        if (!properties) return;
        if (properties.rotationSpeed && properties.rotationSpeed.value !== undefined) {
            ROTATION_SPEED = parseFloat(properties.rotationSpeed.value);
            settings.rotationSpeed = ROTATION_SPEED;
        }
        if (properties.glowIntensity && properties.glowIntensity.value !== undefined) {
            settings.glowIntensity = parseFloat(properties.glowIntensity.value);
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

        // Force a redraw with new settings
        syncLayoutPositions();
        drawCanvasContext();
    }
};

buildTreeStructure();
handleDisplayResize();
fetchAndApplyLiveScores();

window.addEventListener('resize', handleDisplayResize);
setInterval(fetchAndApplyLiveScores, 5 * 60 * 1000);
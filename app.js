// Global Application State
let audioCtx = null;
let isPlaying = false;

// Audio Nodes for Live Playback
let osc1 = null;
let osc2 = null;
let beatGain = null;
let pinkSource = null;
let pinkGain = null;
let masterGain = null;
let analyser = null;

// Pre-generated Pink Noise Buffer
let pinkNoiseBuffer = null;

// Audio & Session Parameters
let beatFreq = 6.0;      // Beat frequency (Hz)
let carrierFreq = 150.0;  // Carrier frequency (Hz)
let durationMinutes = 30; // Track duration (minutes)
let beatVolume = 0.7;    // Beat volume (0.0 - 1.0)
let pinkVolume = 0.3;    // Pink noise volume (0.0 - 1.0)
let masterVolume = 0.8;  // Master volume (0.0 - 1.0)
let isPinkMuted = false;

// Live Playback Timer
let elapsedSeconds = 0;
let countdownInterval = null;
let lastTickTime = null;

// DOM Elements
const elements = {
    beatFreqSlider: document.getElementById('beat-freq'),
    beatFreqVal: document.getElementById('beat-freq-val'),
    beatFreqNum: document.getElementById('beat-freq-num'),
    btnBeatMinus: document.getElementById('btn-beat-minus'),
    btnBeatPlus: document.getElementById('btn-beat-plus'),
    
    carrierFreqSlider: document.getElementById('carrier-freq'),
    carrierFreqVal: document.getElementById('carrier-freq-val'),
    
    durationButtons: document.querySelectorAll('.btn-preset-time'),
    durationNum: document.getElementById('duration-num'),
    
    beatVolSlider: document.getElementById('beat-vol'),
    beatVolVal: document.getElementById('beat-vol-val'),
    pinkVolSlider: document.getElementById('pink-vol'),
    pinkVolVal: document.getElementById('pink-vol-val'),
    masterVolSlider: document.getElementById('master-vol'),
    masterVolVal: document.getElementById('master-vol-val'),
    btnMutePink: document.getElementById('btn-mute-pink'),
    mutePinkIcon: document.getElementById('mute-pink-icon'),
    
    btnPlay: document.getElementById('btn-play'),
    btnStop: document.getElementById('btn-stop'),
    currentTimeDisplay: document.getElementById('current-time'),
    totalTimeDisplay: document.getElementById('total-time'),
    appStatus: document.getElementById('app-status'),
    statusDot: document.querySelector('.status-dot'),
    statusText: document.querySelector('.status-text'),
    
    btnExportWav: document.getElementById('btn-export-wav'),
    btnExportMp3: document.getElementById('btn-export-mp3'),
    exportProgressArea: document.getElementById('export-progress-area'),
    exportProgressBar: document.getElementById('export-progress-bar'),
    exportStatusText: document.getElementById('export-status-text'),
    exportPercentText: document.getElementById('export-percent-text'),
    
    canvas: document.getElementById('oscilloscope'),
    visualizerPlaceholder: document.getElementById('visualizer-placeholder'),
    presetButtons: document.querySelectorAll('.preset-btn')
};

// Canvas Visualizer Initialization
const canvasCtx = elements.canvas.getContext('2d');
let animationFrameId = null;

// Handle Canvas Resize
function resizeCanvas() {
    elements.canvas.width = elements.canvas.offsetWidth * window.devicePixelRatio;
    elements.canvas.height = elements.canvas.offsetHeight * window.devicePixelRatio;
    canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ============================================================================
// PINK NOISE GENERATOR (Paul Kellet's Refined Algorithm)
// ============================================================================
function createPinkNoiseBuffer(ctx, durationSeconds = 4) {
    const sampleRate = ctx.sampleRate;
    const bufferSize = sampleRate * durationSeconds;
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    
    let b0, b1, b2, b3, b4, b5, b6;
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;
    
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        
        // Keep signal levels optimal without clipping
        data[i] = pink * 0.11;
    }
    return buffer;
}

// Initialize AudioContext and pre-generate pink noise
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        pinkNoiseBuffer = createPinkNoiseBuffer(audioCtx, 4);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// ============================================================================
// LIVE PLAYBACK CONTROL LOGIC
// ============================================================================

// Dynamically update audio node parameters for real-time adjustments
function updateLiveAudioNodes() {
    if (!audioCtx || !isPlaying) return;
    
    const now = audioCtx.currentTime;
    
    // Calculate the two frequencies for real monaural physical interference
    const f1 = carrierFreq - (beatFreq / 2);
    const f2 = carrierFreq + (beatFreq / 2);
    
    // Adjust frequencies with smooth ramps (avoids acoustic clicking)
    if (osc1) osc1.frequency.setTargetAtTime(f1, now, 0.08);
    if (osc2) osc2.frequency.setTargetAtTime(f2, now, 0.08);
    
    // Calculate fade-out factor if in the final 3 minutes
    const totalSeconds = durationMinutes * 60;
    const fadeDuration = totalSeconds <= 300 ? totalSeconds * 0.1 : 180; // 10% for short tracks, 3 min for standard
    const secondsRemaining = totalSeconds - elapsedSeconds;
    
    let fadeFactor = 1.0;
    if (secondsRemaining < fadeDuration && secondsRemaining > 0) {
        fadeFactor = secondsRemaining / fadeDuration;
    } else if (secondsRemaining <= 0) {
        fadeFactor = 0.0;
    }
    
    // Apply volumes scaled by fade-out factor
    if (beatGain) {
        beatGain.gain.setTargetAtTime(beatVolume * fadeFactor, now, 0.05);
    }
    
    if (pinkGain) {
        const targetPinkVol = isPinkMuted ? 0 : pinkVolume;
        pinkGain.gain.setTargetAtTime(targetPinkVol * fadeFactor, now, 0.05);
    }
    
    if (masterGain) {
        masterGain.gain.setTargetAtTime(masterVolume, now, 0.05);
    }
}

// Start live audio playback
function startAudio() {
    initAudio();
    
    const now = audioCtx.currentTime;
    
    // Create audio graph nodes
    osc1 = audioCtx.createOscillator();
    osc2 = audioCtx.createOscillator();
    beatGain = audioCtx.createGain();
    
    pinkSource = audioCtx.createBufferSource();
    pinkGain = audioCtx.createGain();
    
    masterGain = audioCtx.createGain();
    analyser = audioCtx.createAnalyser();
    
    // Configure analyzer for oscilloscope
    analyser.fftSize = 2048;
    
    // Configure oscillators (sine waves for pure brainwave stimulation)
    osc1.type = 'sine';
    osc2.type = 'sine';
    
    // Configure loopable pink noise source
    pinkSource.buffer = pinkNoiseBuffer;
    pinkSource.loop = true;
    
    // Connections
    osc1.connect(beatGain);
    osc2.connect(beatGain);
    beatGain.connect(masterGain);
    
    pinkSource.connect(pinkGain);
    pinkGain.connect(masterGain);
    
    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    // Set initial parameters
    isPlaying = true;
    updateLiveAudioNodes();
    
    // Start generators
    osc1.start(now);
    osc2.start(now);
    pinkSource.start(now);
    
    // Timer management
    lastTickTime = Date.now();
    countdownInterval = setInterval(tickTimer, 200);
    
    // Update UI
    elements.btnPlay.querySelector('.play-icon').classList.add('hidden');
    elements.btnPlay.querySelector('.pause-icon').classList.remove('hidden');
    elements.btnStop.removeAttribute('disabled');
    elements.appStatus.classList.add('playing');
    elements.statusText.textContent = "Playing";
    elements.visualizerPlaceholder.classList.add('hidden');
    
    // Start visualizer animation
    drawOscilloscope();
}

// Stop or pause live playback
function stopAudio(fade = true) {
    if (!isPlaying) return;
    
    isPlaying = false;
    clearInterval(countdownInterval);
    countdownInterval = null;
    
    if (audioCtx && fade) {
        // Quick fade-out to prevent clicks when stopping manually
        const now = audioCtx.currentTime;
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        
        setTimeout(() => {
            cleanupAudioNodes();
        }, 200);
    } else {
        cleanupAudioNodes();
    }
    
    // Reset UI
    elements.btnPlay.querySelector('.play-icon').classList.remove('hidden');
    elements.btnPlay.querySelector('.pause-icon').classList.add('hidden');
    elements.btnStop.setAttribute('disabled', 'true');
    elements.appStatus.classList.remove('playing');
    elements.statusText.textContent = "Audio Ready";
    elements.visualizerPlaceholder.classList.remove('hidden');
    
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Clear Canvas
    const w = elements.canvas.width / window.devicePixelRatio;
    const h = elements.canvas.height / window.devicePixelRatio;
    canvasCtx.clearRect(0, 0, w, h);
}

// Clean up audio node references
function cleanupAudioNodes() {
    try {
        if (osc1) { osc1.stop(); osc1.disconnect(); }
        if (osc2) { osc2.stop(); osc2.disconnect(); }
        if (pinkSource) { pinkSource.stop(); pinkSource.disconnect(); }
        if (beatGain) beatGain.disconnect();
        if (pinkGain) pinkGain.disconnect();
        if (masterGain) masterGain.disconnect();
        if (analyser) analyser.disconnect();
    } catch(e) {
        console.warn("Error cleaning up audio nodes: ", e);
    }
    
    osc1 = null;
    osc2 = null;
    beatGain = null;
    pinkSource = null;
    pinkGain = null;
    masterGain = null;
    analyser = null;
}

// Timer tick event handler for live play
function tickTimer() {
    if (!isPlaying) return;
    
    const now = Date.now();
    const dt = (now - lastTickTime) / 1000;
    lastTickTime = now;
    
    elapsedSeconds += dt;
    const totalSeconds = durationMinutes * 60;
    
    // Update elapsed time display
    elements.currentTimeDisplay.textContent = formatTime(Math.min(elapsedSeconds, totalSeconds));
    
    // Force live parameters update to handle fade-out calculations
    updateLiveAudioNodes();
    
    if (elapsedSeconds >= totalSeconds) {
        // Automatic session end
        stopAudio(true);
        elapsedSeconds = 0;
        elements.currentTimeDisplay.textContent = formatTime(0);
    }
}

// ============================================================================
// OSCILLOSCOPE WAVEFORM VISUALIZER
// ============================================================================
function drawOscilloscope() {
    if (!isPlaying || !analyser) return;
    
    animationFrameId = requestAnimationFrame(drawOscilloscope);
    
    const width = elements.canvas.width / window.devicePixelRatio;
    const height = elements.canvas.height / window.devicePixelRatio;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);
    
    canvasCtx.fillStyle = 'rgba(5, 4, 12, 0.25)'; // Trail effect
    canvasCtx.fillRect(0, 0, width, height);
    
    // Draw background grid (subtle and futuristic)
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    canvasCtx.lineWidth = 1;
    
    // Vertical grid lines
    for (let i = 0; i < width; i += 40) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(i, 0);
        canvasCtx.lineTo(i, height);
        canvasCtx.stroke();
    }
    // Horizontal grid lines
    for (let i = 0; i < height; i += 30) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, i);
        canvasCtx.lineTo(width, i);
        canvasCtx.stroke();
    }
    
    // Draw wave path
    canvasCtx.beginPath();
    
    // Set color gradient according to active preset
    const gradient = canvasCtx.createLinearGradient(0, 0, width, 0);
    const activePreset = document.querySelector('.preset-btn.active');
    let glowColor = 'rgba(168, 85, 247, 0.8)'; // default theta/purple
    
    if (activePreset) {
        const preset = activePreset.dataset.preset;
        if (preset === 'delta') {
            gradient.addColorStop(0, '#06b6d4');
            gradient.addColorStop(1, '#3b82f6');
            glowColor = 'rgba(6, 182, 212, 0.8)';
        } else if (preset === 'theta') {
            gradient.addColorStop(0, '#a855f7');
            gradient.addColorStop(1, '#6366f1');
            glowColor = 'rgba(168, 85, 247, 0.8)';
        } else if (preset === 'alpha') {
            gradient.addColorStop(0, '#10b981');
            gradient.addColorStop(1, '#059669');
            glowColor = 'rgba(16, 185, 129, 0.8)';
        } else if (preset === 'beta') {
            gradient.addColorStop(0, '#f59e0b');
            gradient.addColorStop(1, '#d97706');
            glowColor = 'rgba(245, 158, 11, 0.8)';
        } else if (preset === 'gamma') {
            gradient.addColorStop(0, '#ef4444');
            gradient.addColorStop(1, '#b91c1c');
            glowColor = 'rgba(239, 68, 68, 0.8)';
        }
    } else {
        gradient.addColorStop(0, '#ec4899');
        gradient.addColorStop(1, '#a855f7');
    }
    
    canvasCtx.strokeStyle = gradient;
    canvasCtx.lineWidth = 2.5;
    canvasCtx.shadowBlur = 10;
    canvasCtx.shadowColor = glowColor;
    
    const sliceWidth = width / bufferLength;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0; // Normalize 0.0 - 2.0
        const y = (v * height) / 2;     // Scale to canvas center
        
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        
        x += sliceWidth;
    }
    
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();
    
    // Reset shadow blur to avoid performance hit elsewhere
    canvasCtx.shadowBlur = 0;
}

// ============================================================================
// OFFLINE HIGH-SPEED RENDERING & WAV EXPORT
// ============================================================================
async function exportAudioWav() {
    // Stop live audio if playing
    if (isPlaying) {
        stopAudio(false);
    }
    
    // Disable export/play controls during export process
    elements.btnExportWav.setAttribute('disabled', 'true');
    elements.btnExportMp3.setAttribute('disabled', 'true');
    elements.btnPlay.setAttribute('disabled', 'true');
    elements.exportProgressArea.classList.remove('hidden');
    
    const sampleRate = 44100;
    const totalSeconds = durationMinutes * 60;
    const totalSamples = sampleRate * totalSeconds;
    
    // Memory limit safeguard (max 60 minutes)
    if (durationMinutes > 60) {
        alert("For browser memory performance reasons, the maximum exportable duration is limited to 60 minutes.");
        resetExportUI();
        return;
    }
    
    updateExportProgress(5, "Initializing synthesis environment...");
    
    try {
        // Create OfflineAudioContext (Stereo, 44.1kHz)
        const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
        
        // Generate pink noise for this context
        updateExportProgress(15, "Generating background pink noise...");
        const offlinePinkBuffer = createPinkNoiseBuffer(offlineCtx, 4);
        
        // Rebuild audio graph inside offline context
        const oscO1 = offlineCtx.createOscillator();
        const oscO2 = offlineCtx.createOscillator();
        const bGain = offlineCtx.createGain();
        const pSource = offlineCtx.createBufferSource();
        const pGain = offlineCtx.createGain();
        const mGain = offlineCtx.createGain();
        
        oscO1.type = 'sine';
        oscO2.type = 'sine';
        
        // Set up monaural frequencies
        const f1 = carrierFreq - (beatFreq / 2);
        const f2 = carrierFreq + (beatFreq / 2);
        oscO1.frequency.setValueAtTime(f1, 0);
        oscO2.frequency.setValueAtTime(f2, 0);
        
        // Setup pink noise looping source
        pSource.buffer = offlinePinkBuffer;
        pSource.loop = true;
        
        // Connections
        oscO1.connect(bGain);
        oscO2.connect(bGain);
        bGain.connect(mGain);
        
        pSource.connect(pGain);
        pGain.connect(mGain);
        
        mGain.connect(offlineCtx.destination);
        
        // Set volumes based on user controls
        bGain.gain.setValueAtTime(beatVolume, 0);
        pGain.gain.setValueAtTime(isPinkMuted ? 0 : pinkVolume, 0);
        
        // Apply precise Master Gain fade-out in final minutes
        const fadeDuration = totalSeconds <= 300 ? totalSeconds * 0.1 : 180;
        const fadeStartTime = totalSeconds - fadeDuration;
        
        mGain.gain.setValueAtTime(masterVolume, 0);
        mGain.gain.setValueAtTime(masterVolume, fadeStartTime);
        mGain.gain.linearRampToValueAtTime(0.0001, totalSeconds); // Fade to absolute silence
        
        // Start offline synthesis nodes
        oscO1.start(0);
        oscO2.start(0);
        pSource.start(0);
        
        oscO1.stop(totalSeconds);
        oscO2.stop(totalSeconds);
        pSource.stop(totalSeconds);
        
        updateExportProgress(25, "Acoustic rendering (calculating wave interference)...");
        
        // Simulate progress rendering (actual offline rendering is very fast but asynchronous)
        let renderPercent = 25;
        const progressTimer = setInterval(() => {
            if (renderPercent < 85) {
                renderPercent += Math.floor(Math.random() * 5) + 2;
                updateExportProgress(renderPercent, "Calculating audio samples...");
            }
        }, 300);
        
        // Execute actual rendering
        const renderedBuffer = await offlineCtx.startRendering();
        clearInterval(progressTimer);
        
        updateExportProgress(88, "Encoding 16-bit WAV audio file...");
        
        // Convert to WAV inside a microtask so it doesn't block UI
        await new Promise(resolve => setTimeout(resolve, 50));
        const wavBlob = audioBufferToWav(renderedBuffer);
        
        updateExportProgress(98, "Preparing download...");
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Trigger file download
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        // Generate a descriptive filename
        const presetName = document.querySelector('.preset-btn.active')?.dataset.preset || 'custom';
        a.download = `monoaurals_${presetName}_${beatFreq.toFixed(1)}hz_${durationMinutes}min.wav`;
        
        document.body.appendChild(a);
        a.click();
        
        // Cleanup download DOM elements and reset
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            updateExportProgress(100, "Export completed!");
            
            setTimeout(() => {
                resetExportUI();
            }, 1500);
        }, 500);
        
    } catch (error) {
        console.error("Export error:", error);
        alert("An error occurred during audio track generation.");
        resetExportUI();
    }
}

// Update export progress elements
function updateExportProgress(percent, statusText) {
    elements.exportProgressBar.style.width = `${percent}%`;
    elements.exportPercentText.textContent = `${percent}%`;
    elements.exportStatusText.textContent = statusText;
}

// Reset export UI state back to default
function resetExportUI() {
    elements.exportProgressArea.classList.add('hidden');
    elements.btnExportWav.removeAttribute('disabled');
    elements.btnExportMp3.removeAttribute('disabled');
    elements.btnPlay.removeAttribute('disabled');
    updateExportProgress(0, "");
}

// ============================================================================
// OFFLINE HIGH-SPEED RENDERING & MP3 EXPORT
// ============================================================================
async function exportAudioMp3() {
    // Stop live audio if playing
    if (isPlaying) {
        stopAudio(false);
    }
    
    // Disable export/play controls during export process
    elements.btnExportWav.setAttribute('disabled', 'true');
    elements.btnExportMp3.setAttribute('disabled', 'true');
    elements.btnPlay.setAttribute('disabled', 'true');
    elements.exportProgressArea.classList.remove('hidden');
    
    const sampleRate = 44100;
    const totalSeconds = durationMinutes * 60;
    const totalSamples = sampleRate * totalSeconds;
    
    // Memory limit safeguard (max 60 minutes)
    if (durationMinutes > 60) {
        alert("For browser memory performance reasons, the maximum exportable duration is limited to 60 minutes.");
        resetExportUI();
        return;
    }
    
    updateExportProgress(5, "Initializing synthesis environment...");
    
    try {
        // Create OfflineAudioContext (Stereo, 44.1kHz)
        const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
        
        // Generate pink noise for this context
        updateExportProgress(12, "Generating background pink noise...");
        const offlinePinkBuffer = createPinkNoiseBuffer(offlineCtx, 4);
        
        // Rebuild audio graph inside offline context
        const oscO1 = offlineCtx.createOscillator();
        const oscO2 = offlineCtx.createOscillator();
        const bGain = offlineCtx.createGain();
        const pSource = offlineCtx.createBufferSource();
        const pGain = offlineCtx.createGain();
        const mGain = offlineCtx.createGain();
        
        oscO1.type = 'sine';
        oscO2.type = 'sine';
        
        // Set up monaural frequencies
        const f1 = carrierFreq - (beatFreq / 2);
        const f2 = carrierFreq + (beatFreq / 2);
        oscO1.frequency.setValueAtTime(f1, 0);
        oscO2.frequency.setValueAtTime(f2, 0);
        
        // Setup pink noise looping source
        pSource.buffer = offlinePinkBuffer;
        pSource.loop = true;
        
        // Connections
        oscO1.connect(bGain);
        oscO2.connect(bGain);
        bGain.connect(mGain);
        
        pSource.connect(pGain);
        pGain.connect(mGain);
        
        mGain.connect(offlineCtx.destination);
        
        // Set volumes based on user controls
        bGain.gain.setValueAtTime(beatVolume, 0);
        pGain.gain.setValueAtTime(isPinkMuted ? 0 : pinkVolume, 0);
        
        // Apply precise Master Gain fade-out in final minutes
        const fadeDuration = totalSeconds <= 300 ? totalSeconds * 0.1 : 180;
        const fadeStartTime = totalSeconds - fadeDuration;
        
        mGain.gain.setValueAtTime(masterVolume, 0);
        mGain.gain.setValueAtTime(masterVolume, fadeStartTime);
        mGain.gain.linearRampToValueAtTime(0.0001, totalSeconds); // Fade to absolute silence
        
        // Start offline nodes
        oscO1.start(0);
        oscO2.start(0);
        pSource.start(0);
        
        oscO1.stop(totalSeconds);
        oscO2.stop(totalSeconds);
        pSource.stop(totalSeconds);
        
        updateExportProgress(20, "Acoustic rendering (calculating wave interference)...");
        
        // Execute actual rendering
        const renderedBuffer = await offlineCtx.startRendering();
        
        updateExportProgress(30, "Initializing MP3 encoder (256 kbps)...");
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const leftFloat = renderedBuffer.getChannelData(0);
        const rightFloat = renderedBuffer.getChannelData(1);
        const length = leftFloat.length;
        
        // Initialize LAME MP3 Encoder (Stereo, 44.1kHz, 256kbps)
        const mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, 256);
        const mp3Data = [];
        
        // Chunk size: 1152 * 200 = 230,400 samples (about 5.2 seconds of audio)
        const chunkSize = 1152 * 200;
        let offset = 0;
        
        function encodeChunk() {
            if (offset < length) {
                const end = Math.min(offset + chunkSize, length);
                const currentChunkSize = end - offset;
                
                const leftInt16 = new Int16Array(currentChunkSize);
                const rightInt16 = new Int16Array(currentChunkSize);
                
                // Convert Float32 samples to Int16 PCM range
                for (let i = 0; i < currentChunkSize; i++) {
                    let s = leftFloat[offset + i];
                    s = Math.max(-1, Math.min(1, s));
                    leftInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    
                    s = rightFloat[offset + i];
                    s = Math.max(-1, Math.min(1, s));
                    rightInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // Encode the stereo pair
                const mp3buf = mp3encoder.encodeBuffer(leftInt16, rightInt16);
                if (mp3buf.length > 0) {
                    mp3Data.push(mp3buf);
                }
                
                offset += chunkSize;
                const percent = 30 + Math.floor((offset / length) * 65); // Progress from 30% to 95%
                updateExportProgress(percent, `Encoding MP3 audio frames... (${percent}%)`);
                
                // Yield thread to keep browser UI active and responsive
                setTimeout(encodeChunk, 0);
            } else {
                // Finalize and flush LAME buffers
                updateExportProgress(96, "Flushing MP3 encoder buffers...");
                setTimeout(() => {
                    const flushBuf = mp3encoder.flush();
                    if (flushBuf.length > 0) {
                        mp3Data.push(new Int8Array(flushBuf));
                    }
                    
                    updateExportProgress(98, "Preparing download file...");
                    
                    // Trigger download
                    const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
                    const url = URL.createObjectURL(mp3Blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    
                    const presetName = document.querySelector('.preset-btn.active')?.dataset.preset || 'custom';
                    a.download = `monoaurals_${presetName}_${beatFreq.toFixed(1)}hz_${durationMinutes}min.mp3`;
                    
                    document.body.appendChild(a);
                    a.click();
                    
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        updateExportProgress(100, "MP3 Export completed!");
                        setTimeout(resetExportUI, 1200);
                    }, 500);
                }, 50);
            }
        }
        
        // Start the chunked encoding loop
        encodeChunk();
        
    } catch (error) {
        console.error("MP3 Export error:", error);
        alert("An error occurred during MP3 track generation.");
        resetExportUI();
    }
}

// ============================================================================
// WAV FILE ENCODER UTILITY (16-bit stereo PCM)
// ============================================================================
function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // 1 = Uncompressed PCM
    const bitDepth = 16;
    
    // Interleave left and right channels if stereo, otherwise copy mono
    let samples;
    if (numChannels === 2) {
        samples = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
    } else {
        samples = buffer.getChannelData(0);
    }
    
    const bufferLength = samples.length * 2; // 16-bit = 2 bytes per sample
    const wavBuffer = new ArrayBuffer(44 + bufferLength);
    const view = new DataView(wavBuffer);
    
    // WRITE WAV FILE HEADERS
    // 1. Chunk ID "RIFF"
    writeString(view, 0, 'RIFF');
    // 2. Chunk Size (36 + data size)
    view.setUint32(4, 36 + bufferLength, true);
    // 3. Format "WAVE"
    writeString(view, 8, 'WAVE');
    // 4. Subchunk1 ID "fmt "
    writeString(view, 12, 'fmt ');
    // 5. Subchunk1 Size (16 for PCM)
    view.setUint32(16, 16, true);
    // 6. Audio Format (1 for PCM)
    view.setUint16(20, format, true);
    // 7. Num Channels
    view.setUint16(22, numChannels, true);
    // 8. Sample Rate
    view.setUint32(24, sampleRate, true);
    // 9. Byte Rate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    // 10. Block Align (NumChannels * BitsPerSample/8)
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    // 11. Bits Per Sample
    view.setUint16(34, bitDepth, true);
    // 12. Subchunk2 ID "data"
    writeString(view, 36, 'data');
    // 13. Subchunk2 Size
    view.setUint32(40, bufferLength, true);
    
    // Write PCM 16-bit signed integer samples
    floatTo16BitPCM(view, 44, samples);
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
}

// Interleave L and R channels together
function interleave(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;
    
    while (index < length) {
        result[index++] = inputL[inputIndex];
        result[index++] = inputR[inputIndex];
        inputIndex++;
    }
    return result;
}

// Convert float32 (-1.0 to 1.0) into 16-bit signed integer (-32768 to 32767)
function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// ============================================================================
// TIME FORMATTING & UI EVENT HANDLERS
// ============================================================================

// Convert seconds into HH:MM:SS format
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [
        h.toString().padStart(2, '0'),
        m.toString().padStart(2, '0'),
        s.toString().padStart(2, '0')
    ].join(':');
}

// Sync all UI element displays related to track duration
function updateDurationUI() {
    const totalSeconds = durationMinutes * 60;
    elements.totalTimeDisplay.textContent = formatTime(totalSeconds);
    elements.currentTimeDisplay.textContent = formatTime(Math.min(elapsedSeconds, totalSeconds));
}

// Event Listeners for Beat Frequency Regulation
elements.beatFreqSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    beatFreq = val;
    elements.beatFreqVal.textContent = val.toFixed(1);
    elements.beatFreqNum.value = val.toFixed(1);
    deactivatePresets();
    updateLiveAudioNodes();
});

elements.beatFreqNum.addEventListener('change', (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 6.0;
    val = Math.max(0.5, Math.min(50, val));
    
    beatFreq = val;
    elements.beatFreqSlider.value = val;
    elements.beatFreqVal.textContent = val.toFixed(1);
    elements.beatFreqNum.value = val.toFixed(1);
    deactivatePresets();
    updateLiveAudioNodes();
});

elements.btnBeatMinus.addEventListener('click', () => {
    let val = parseFloat(elements.beatFreqNum.value) - 0.1;
    val = Math.max(0.5, val);
    beatFreq = val;
    elements.beatFreqSlider.value = val;
    elements.beatFreqVal.textContent = val.toFixed(1);
    elements.beatFreqNum.value = val.toFixed(1);
    deactivatePresets();
    updateLiveAudioNodes();
});

elements.btnBeatPlus.addEventListener('click', () => {
    let val = parseFloat(elements.beatFreqNum.value) + 0.1;
    val = Math.min(50, val);
    beatFreq = val;
    elements.beatFreqSlider.value = val;
    elements.beatFreqVal.textContent = val.toFixed(1);
    elements.beatFreqNum.value = val.toFixed(1);
    deactivatePresets();
    updateLiveAudioNodes();
});

// Event Listener for Carrier Base Tone
elements.carrierFreqSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    carrierFreq = val;
    elements.carrierFreqVal.textContent = val;
    updateLiveAudioNodes();
});

// Preset Button Click Event Handlers
elements.presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.presetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const freq = parseFloat(btn.dataset.freq);
        beatFreq = freq;
        elements.beatFreqSlider.value = freq;
        elements.beatFreqVal.textContent = freq.toFixed(1);
        elements.beatFreqNum.value = freq.toFixed(1);
        
        updateLiveAudioNodes();
    });
});

function deactivatePresets() {
    elements.presetButtons.forEach(b => b.classList.remove('active'));
}

// Duration Selection Event Handlers
elements.durationButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.durationButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const mins = parseInt(btn.dataset.minutes, 10);
        durationMinutes = mins;
        elements.durationNum.value = mins;
        
        // Stop playback if current position is past new duration
        if (isPlaying && elapsedSeconds >= durationMinutes * 60) {
            stopAudio(true);
            elapsedSeconds = 0;
        }
        updateDurationUI();
    });
});

elements.durationNum.addEventListener('change', (e) => {
    let mins = parseInt(e.target.value, 10);
    if (isNaN(mins) || mins < 1) mins = 30;
    mins = Math.min(180, mins); // Cap at 3 hours
    
    durationMinutes = mins;
    elements.durationNum.value = mins;
    
    // Update active preset state
    elements.durationButtons.forEach(btn => {
        if (parseInt(btn.dataset.minutes, 10) === mins) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    if (isPlaying && elapsedSeconds >= durationMinutes * 60) {
        stopAudio(true);
        elapsedSeconds = 0;
    }
    updateDurationUI();
});

// Audio Volume Mixer Event Handlers
elements.beatVolSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    beatVolume = val / 100;
    elements.beatVolVal.textContent = `${val}%`;
    updateLiveAudioNodes();
});

elements.pinkVolSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    pinkVolume = val / 100;
    elements.pinkVolVal.textContent = `${val}%`;
    updateLiveAudioNodes();
});

elements.masterVolSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    masterVolume = val / 100;
    elements.masterVolVal.textContent = `${val}%`;
    updateLiveAudioNodes();
});

elements.btnMutePink.addEventListener('click', () => {
    isPinkMuted = !isPinkMuted;
    if (isPinkMuted) {
        elements.btnMutePink.classList.add('muted');
        elements.mutePinkIcon.style.color = '#ef4444'; // Red color
        elements.pinkVolVal.style.color = 'var(--text-inactive)';
    } else {
        elements.btnMutePink.classList.remove('muted');
        elements.mutePinkIcon.style.color = 'currentColor';
        elements.pinkVolVal.style.color = 'var(--text-primary)';
    }
    updateLiveAudioNodes();
});

// Play / Stop / Export Main Button Handlers
elements.btnPlay.addEventListener('click', () => {
    if (isPlaying) {
        stopAudio(true);
    } else {
        startAudio();
    }
});

elements.btnStop.addEventListener('click', () => {
    stopAudio(true);
    elapsedSeconds = 0;
    elements.currentTimeDisplay.textContent = formatTime(0);
});

elements.btnExportWav.addEventListener('click', () => {
    exportAudioWav();
});

elements.btnExportMp3.addEventListener('click', () => {
    exportAudioMp3();
});

// Initial flat visualizer waveform at idle state
function initVisualizerPlaceholder() {
    const w = elements.canvas.width / window.devicePixelRatio;
    const h = elements.canvas.height / window.devicePixelRatio;
    canvasCtx.clearRect(0, 0, w, h);
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, h / 2);
    canvasCtx.lineTo(w, h / 2);
    canvasCtx.stroke();
}

// Run Initial Setup
updateDurationUI();
initVisualizerPlaceholder();

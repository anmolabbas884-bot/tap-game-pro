/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Timer, Play, RotateCcw, Zap, Volume2, VolumeX, Info, Settings, Sliders, Palette, Check, Maximize, Minimize, Star, Clock, User, Activity } from 'lucide-react';
import { initFirebase, auth, signInWithGoogle } from './lib/firebase';
import { getTopScores, saveHighScore, LeaderboardEntry } from './services/leaderboardService';

interface Circle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  letter: string;
  type: 'NORMAL' | 'BONUS_POINTS' | 'BONUS_TIME';
}

interface Particle {
  id: number;
  tx: number;
  ty: number;
  size: number;
}

interface TapEffect {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  particles: Particle[];
  isKeyboard?: boolean;
  type?: Circle['type'];
}

const COLORS = ["#22c55e", "#38bdf8", "#facc15", "#fb7185", "#a855f7"];
const COLOR_FREQ_BASE: Record<string, number> = {
  "#22c55e": 261.63, // Green (C4)
  "#38bdf8": 329.63, // Blue (E4)
  "#facc15": 392.00, // Yellow (G4)
  "#fb7185": 440.00, // Red (A4)
  "#a855f7": 523.25, // Purple (C5)
};
const WAVEFORMS: Record<Difficulty, OscillatorType> = {
  EASY: 'sine',
  MEDIUM: 'triangle',
  HARD: 'square'
};
const FEEDBACK_WORDS = ["NICE!", "WOW!", "PRO!", "GREAT!", "EXCELLENT!", "SUPER!", "FAST!"];

type Theme = 'CLASSIC' | 'NEON' | 'MONO' | 'CYBER';

const THEMES: Record<Theme, { name: string; primary: string; secondary: string; bg: string; accent: string }> = {
  CLASSIC: { name: 'Classic', primary: '#38bdf8', secondary: '#0ea5e9', bg: 'bg-slate-950', accent: 'sky' },
  NEON: { name: 'Neon', primary: '#f472b6', secondary: '#db2777', bg: 'bg-black', accent: 'pink' },
  MONO: { name: 'Bento', primary: '#f8fafc', secondary: '#94a3b8', bg: 'bg-zinc-950', accent: 'zinc' },
  CYBER: { name: 'Cyber', primary: '#22c55e', secondary: '#16a34a', bg: 'bg-green-950/10', accent: 'emerald' },
};

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

const DIFFICULTY_SETTINGS: Record<Difficulty, { speed: number; label: string; color: string; multiplier: number }> = {
  EASY: { speed: 1500, label: 'Easy', color: 'text-emerald-400', multiplier: 1 },
  MEDIUM: { speed: 1200, label: 'Medium', color: 'text-sky-400', multiplier: 2 },
  HARD: { speed: 800, label: 'Hard', color: 'text-rose-400', multiplier: 3 }
};

export default function App() {
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    const saved = localStorage.getItem("tapDifficulty");
    return (saved as Difficulty) || 'MEDIUM';
  });
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("tapVolume");
    return saved ? parseFloat(saved) : 0.5;
  });
  const [soundSettings, setSoundSettings] = useState(() => {
    const saved = localStorage.getItem("tapSoundSettings");
    return saved ? JSON.parse(saved) : {
      tap: true,
      bonus: true,
      miss: true,
      combo: true
    };
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("tapTheme");
    return (saved as Theme) || 'CLASSIC';
  });
  const [user, setUser] = useState(auth.currentUser);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("tapPlayerName") || "Player " + Math.floor(Math.random() * 1000));
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(() => {
    const saved = localStorage.getItem("tapSessionDuration");
    return saved ? parseInt(saved, 10) : 30;
  });
  const lastTapTime = useRef(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem("tapHighScore");
    return saved ? parseInt(saved, 10) : 0;
  });
  const [speed, setSpeed] = useState(() => {
    const savedDifficulty = localStorage.getItem("tapDifficulty") as Difficulty;
    return DIFFICULTY_SETTINGS[savedDifficulty || 'MEDIUM'].speed;
  });
  const [gameSpeed, setGameSpeed] = useState(() => {
    const saved = localStorage.getItem("tapGameSpeed");
    return saved ? parseFloat(saved) : 1.0;
  });
  const [circles, setCircles] = useState<Circle[]>([]);
  const [effects, setEffects] = useState<TapEffect[]>([]);
  const [isKeyboardHit, setIsKeyboardHit] = useState(false);
  const [isBonusHit, setIsBonusHit] = useState(false);
  const [sensitivity, setSensitivity] = useState(() => {
    const saved = localStorage.getItem("tapSensitivity");
    return saved ? parseFloat(saved) : 1.2;
  });
  const [lastHitColor, setLastHitColor] = useState("#38bdf8");
  const [isMissed, setIsMissed] = useState(false);
  const [isMobileMode, setIsMobileMode] = useState(() => {
    const saved = localStorage.getItem("tapMobileMode");
    if (saved !== null) return saved === 'true';
    
    // Only detect if window is available (client-side)
    if (typeof window !== 'undefined') {
      return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
    }
    return false;
  });
  const [showKeyHints, setShowKeyHints] = useState(() => {
    const saved = localStorage.getItem("tapShowKeyHints");
    return saved === null ? true : saved === 'true';
  });
  const [lastKey, setLastKey] = useState("");
  const [showIntro, setShowIntro] = useState(true);
  const [introStep, setIntroStep] = useState<'TITLE' | 'SETUP'>('TITLE');
  
  const [showHelp, setShowHelp] = useState(false);
  const [difficultyMessage, setDifficultyMessage] = useState<string | null>(null);
  const [preGameCountdown, setPreGameCountdown] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const nextCircleId = useRef(0);
  const nextEffectId = useRef(0);
  const rafMovementRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Update dimensions on resize
  useEffect(() => {
    if (!gameAreaRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    observer.observe(gameAreaRef.current);
    // Initial measure
    const rect = gameAreaRef.current.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });
    
    return () => observer.disconnect();
  }, []);
  const spawnTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const musicIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const musicBufferRef = useRef<AudioBuffer | null>(null);
  const isFadingMusic = useRef(false);

  // Background Beat Logic
  const startBackgroundMusic = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    // Create noise buffer once for hi-hats
    if (!musicBufferRef.current) {
      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      musicBufferRef.current = buffer;
    }
    
    if (!musicGainRef.current) {
      musicGainRef.current = ctx.createGain();
      musicGainRef.current.connect(ctx.destination);
    }
    
    // Set lower master volume for subtle effect
    const finalVolume = isMuted ? 0 : 0.04 * volume;
    musicGainRef.current.gain.setTargetAtTime(finalVolume, ctx.currentTime, 0.5);

    let step = 0;
    const bpm = difficulty === 'HARD' ? 130 : difficulty === 'MEDIUM' ? 115 : 100;
    const stepDuration = 60 / bpm / 2; // 1/8 notes

    // Bass sequence: more atmospheric for electronic feel
    const bassSeq = difficulty === 'HARD' ? [40, 0, 0, 45, 0, 40, 50, 0] : [40, 0, 0, 0, 40, 0, 0, 0];

    const playBeat = () => {
      if (((!isGameRunning && !isFadingMusic.current) || isPaused || isMuted)) return;
      
      const time = ctx.currentTime + 0.05; // Schedule slightly ahead for stability
      
      // 1. Subtle Kick (Pulse)
      if (step % 4 === 0) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(100, time);
        osc.frequency.exponentialRampToValueAtTime(30, time + 0.2);
        g.gain.setValueAtTime(0.25, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
        osc.connect(g);
        g.connect(musicGainRef.current!);
        osc.start(time);
        osc.stop(time + 0.2);
      }

      // 2. Electronic Snare / Snap
      if (step % 8 === 4) {
        const noise = ctx.createBufferSource();
        noise.buffer = musicBufferRef.current;
        const ng = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(800, time);
        ng.gain.setValueAtTime(0.04, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
        noise.connect(filter);
        filter.connect(ng);
        ng.connect(musicGainRef.current!);
        noise.start(time);
        noise.stop(time + 0.1);
      }

      // 3. Crisp Hi-Hats (on off-beats)
      if (step % 2 === 1) {
        const noise = ctx.createBufferSource();
        noise.buffer = musicBufferRef.current;
        const g = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(8000, time);
        g.gain.setValueAtTime(step % 4 === 3 ? 0.025 : 0.015, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        noise.connect(filter);
        filter.connect(g);
        g.connect(musicGainRef.current!);
        noise.start(time);
        noise.stop(time + 0.04);
      }

      // 4. Subtle Electronic Bassline / Pad
      const freq = bassSeq[step % bassSeq.length];
      if (freq > 0) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine'; // Sine for smoothness
        osc.frequency.setValueAtTime(freq, time);
        
        // Longer release for a more "flowing" feel
        g.gain.setValueAtTime(0.03, time);
        g.gain.setTargetAtTime(0, time + 0.05, 0.1);
        
        osc.connect(g);
        g.connect(musicGainRef.current!);
        osc.start(time);
        osc.stop(time + 0.5);
      }

      // 5. Ambient High Drone (Atmosphere)
      if (step === 0) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        // Harmonic relationship to bass
        const baseFreq = difficulty === 'HARD' ? 330 : 220; 
        osc.frequency.setValueAtTime(baseFreq * 2, time);
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.01, time + 0.4);
        g.gain.linearRampToValueAtTime(0, time + 0.8);
        osc.connect(g);
        g.connect(musicGainRef.current!);
        osc.start(time);
        osc.stop(time + 0.8);
      }

      step = (step + 1) % 16;
    };

    if (musicIntervalRef.current) clearInterval(musicIntervalRef.current);
    musicIntervalRef.current = setInterval(playBeat, stepDuration * 1000);
  }, [isGameRunning, isPaused, isMuted, difficulty]);

  useEffect(() => {
    if (isGameRunning && !isPaused && !isMuted) {
      startBackgroundMusic();
    } else if (!isFadingMusic.current) {
      if (musicIntervalRef.current) {
        clearInterval(musicIntervalRef.current);
        musicIntervalRef.current = null;
      }
    }
    return () => {
      if (musicIntervalRef.current) clearInterval(musicIntervalRef.current);
    };
  }, [isGameRunning, isPaused, isMuted, startBackgroundMusic]);

  // Handle fullscreen changes (e.g. Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.error(`Error attempting to enable fullscreen: ${err}`);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }, []);

  // Initialize Firebase and fetch leaderboard
  useEffect(() => {
    const init = async () => {
      await initFirebase();
      refreshLeaderboard();
    };
    init();

    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      const user = await signInWithGoogle();
      if (user && user.displayName) {
        setPlayerName(user.displayName);
        localStorage.setItem("tapPlayerName", user.displayName);
      }
    } catch (err) {
      console.error("Sign in failed:", err);
    }
  };

  const refreshLeaderboard = async () => {
    setIsLeaderboardLoading(true);
    try {
      const topScores = await getTopScores(5);
      setLeaderboard(topScores);
    } catch (error) {
      console.error("Failed to fetch leaderboard:", error);
    } finally {
      setIsLeaderboardLoading(false);
    }
  };

  const syncScoreToLeaderboard = useCallback(async (finalScore: number) => {
    if (finalScore <= 0 || !auth.currentUser) return;
    try {
      await saveHighScore(playerName, finalScore, difficulty);
      refreshLeaderboard();
    } catch (error) {
      console.error("Error saving high score:", error);
    }
  }, [playerName, difficulty]);

  // Update music gain when muted changes
  useEffect(() => {
    if (musicGainRef.current && audioContextRef.current) {
      const finalVolume = isMuted ? 0 : 0.03 * volume;
      musicGainRef.current.gain.setTargetAtTime(finalVolume, audioContextRef.current.currentTime, 0.1);
    }
  }, [isMuted, volume]);

  // sound player
  const playSound = useCallback((frequency: number, type: OscillatorType = 'sine', duration = 0.1, soundVolume = 0.1, sweep = true) => {
    if (isMuted) return;
    
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (sweep) {
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, ctx.currentTime + duration);
    }

    gainNode.gain.setValueAtTime(soundVolume * volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }, [isMuted, volume]);

  const playGameOverSound = useCallback(() => {
    const notes = [440, 330, 220]; // A4, E4, A3
    notes.forEach((freq, i) => {
      setTimeout(() => playSound(freq, 'sawtooth', 0.5, 0.05, false), i * 200);
    });
  }, [playSound]);

  const playStartSound = useCallback(() => {
    const notes = [220, 330, 440, 660]; 
    notes.forEach((freq, i) => {
      setTimeout(() => playSound(freq, 'sine', 0.1, 0.08, true), i * 100);
    });
  }, [playSound]);

  const playBonusSound = useCallback(() => {
    if (!soundSettings.bonus) return;
    // Shimmery arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // C5, E5, G5, C6, E6, G6
    notes.forEach((freq, i) => {
      setTimeout(() => playSound(freq, 'sine', 0.2, 0.04, true), i * 40);
    });
  }, [playSound, soundSettings.bonus]);

  const playMissSound = useCallback(() => {
    if (!soundSettings.miss) {
      setIsMissed(true);
      setTimeout(() => setIsMissed(false), 150);
      return;
    }
    // Dissonant, low-frequency buzz for misses with a thud
    playSound(70, 'triangle', 0.2, 0.15, false); // Sub thud
    setTimeout(() => playSound(90, 'sawtooth', 0.1, 0.1, false), 20); // Buzz
    setTimeout(() => playSound(60, 'sawtooth', 0.15, 0.1, false), 60);
    setIsMissed(true);
    setTimeout(() => setIsMissed(false), 150);
  }, [playSound, soundSettings.miss]);

  const playComboMilestoneSound = useCallback(() => {
    if (!soundSettings.combo) return;
    const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5 (Major chord)
    notes.forEach((freq, i) => {
      setTimeout(() => playSound(freq, 'sine', 0.2, 0.1, true), i * 40);
    });
  }, [playSound, soundSettings.combo]);

  const playKeyboardTapSound = useCallback(() => {
    // Sharp, crisp technical click to differentiate from touch
    // High frequency transient
    playSound(3200, 'square', 0.02, 0.04, false);
    // Metallic resonance
    setTimeout(() => playSound(1600, 'triangle', 0.05, 0.03, true), 10);
  }, [playSound]);

  // Dynamic Difficulty progression
  useEffect(() => {
    if (!isGameRunning || isPaused) return;

    let newDifficulty: Difficulty | null = null;
    
    if (score >= 150 && difficulty !== 'HARD') {
      newDifficulty = 'HARD';
    } else if (score >= 50 && difficulty === 'EASY') {
      newDifficulty = 'MEDIUM';
    }

    if (newDifficulty) {
      setDifficulty(newDifficulty);
      setSpeed(DIFFICULTY_SETTINGS[newDifficulty].speed);
      
      // Visual feedback
      setDifficultyMessage(`${newDifficulty} MODE ACTIVATED!`);
      playSound(880, 'square', 0.5, 0.1, true);
      
      const timer = setTimeout(() => {
        setDifficultyMessage(null);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [score, difficulty, isGameRunning, isPaused, playSound]);

  const resetHighScore = () => {
    if (window.confirm("Are you sure you want to reset your high score to 0?")) {
      setHighScore(0);
      localStorage.setItem("tapHighScore", "0");
      playSound(150, 'sawtooth', 0.3, 0.05, false);
    }
  };

  const runGame = useCallback(() => {
    const settings = DIFFICULTY_SETTINGS[difficulty];
    setScore(0);
    scoreRef.current = 0;
    setCombo(0);
    setMaxCombo(0);
    comboRef.current = 0;
    setTimeLeft(sessionDuration);
    setSpeed(settings.speed);
    setIsGameRunning(true);
    setCircles([]);
    setEffects([]);
    playStartSound();
  }, [difficulty, playStartSound]);

  const startGame = () => {
    if (isGameRunning) return;
    setShowHelp(false);
    setScore(0);
    setCombo(0);
    setCircles([]);
    setEffects([]);
    setPreGameCountdown(3);
    playSound(440, 'sine', 0.1, 0.05, false);
  };

  // Pre-game countdown effect
  useEffect(() => {
    if (preGameCountdown === null) return;
    
    if (preGameCountdown > 0) {
      const timer = setTimeout(() => {
        setPreGameCountdown(prev => prev! - 1);
        if (preGameCountdown > 1) {
          playSound(440, 'sine', 0.1, 0.05, false);
        } else {
          playSound(880, 'sine', 0.2, 0.1, true); // "GO!" beep
        }
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setPreGameCountdown(null);
      runGame();
    }
  }, [preGameCountdown, runGame, playSound]);

  const endGame = useCallback(() => {
    if (musicGainRef.current && audioContextRef.current) {
      isFadingMusic.current = true;
      const ctx = audioContextRef.current;
      musicGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
      musicGainRef.current.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      
      setTimeout(() => {
        isFadingMusic.current = false;
        if (musicIntervalRef.current) {
          clearInterval(musicIntervalRef.current);
          musicIntervalRef.current = null;
        }
      }, 1500);
    } else {
      if (musicIntervalRef.current) {
        clearInterval(musicIntervalRef.current);
        musicIntervalRef.current = null;
      }
    }

    setIsGameRunning(false);
    setIsPaused(false);
    setCircles([]);
    if (timerRef.current) clearInterval(timerRef.current);
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    
    if (scoreRef.current > 0) {
      playGameOverSound();
      syncScoreToLeaderboard(scoreRef.current);
    }
  }, [playGameOverSound, syncScoreToLeaderboard]);

  // Sync high score
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem("tapHighScore", score.toString());
    }
  }, [score, highScore]);

  // Persist settings to localStorage
  useEffect(() => {
    localStorage.setItem("tapDifficulty", difficulty);
    localStorage.setItem("tapVolume", volume.toString());
    localStorage.setItem("tapTheme", theme);
    localStorage.setItem("tapSessionDuration", sessionDuration.toString());
    localStorage.setItem("tapMobileMode", isMobileMode.toString());
    localStorage.setItem("tapSoundSettings", JSON.stringify(soundSettings));
    localStorage.setItem("tapSensitivity", sensitivity.toString());
    localStorage.setItem("tapPlayerName", playerName);
    localStorage.setItem("tapGameSpeed", gameSpeed.toString());
    localStorage.setItem("tapShowKeyHints", showKeyHints.toString());
  }, [difficulty, volume, theme, sessionDuration, isMobileMode, soundSettings, sensitivity, playerName, gameSpeed, showKeyHints]);

  const togglePause = () => {
    if (!isGameRunning) return;
    setIsPaused(prev => !prev);
    playSound(400, 'sine', 0.1, 0.05, false);
  };

  const stopGameEarly = () => {
    endGame();
  };

  // Timer logic
  useEffect(() => {
    if (isGameRunning && !isPaused && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 6 && prev > 1) { // 5, 4, 3, 2, 1 beeps
            playSound(150, 'triangle', 0.05, 0.05, false);
          }
          if (prev === 1) return 0;
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else if (isGameRunning && timeLeft === 0) {
      endGame();
    }
  }, [isGameRunning, isPaused, timeLeft, endGame, playSound]);

  // Spawning logic
  const spawnCircle = useCallback(() => {
    if (!isGameRunning || isPaused || !gameAreaRef.current) return;

    const { width, height } = dimensions;
    if (width === 0 || height === 0) return;

    // Scale circle size based on container - roughly 12% of the smaller dimension
    const baseSize = Math.min(width, height) * 0.12;
    const size = Math.max(45, Math.min(baseSize, 80)); // Clamp between 45px and 80px
    
    const margin = size / 2 + 10;
    const x = Math.random() * (width - margin * 2) + margin;
    const y = Math.random() * (height - margin * 2) + margin;
    
    const getDifficultyLetters = () => {
      switch (difficulty) {
        case 'EASY':
          return "ASDFGHJKL";
        case 'MEDIUM':
          return "ASDFGHJKLQWERTYUIOP";
        case 'HARD':
        default:
          return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      }
    };
    
    const letters = getDifficultyLetters();
    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
    
    // Type probability
    const rand = Math.random();
    let type: Circle['type'] = 'NORMAL';
    if (rand < 0.05) type = 'BONUS_POINTS';
    else if (rand < 0.10) type = 'BONUS_TIME';

    const newCircle: Circle = {
      id: nextCircleId.current++,
      x,
      y,
      color: type === 'BONUS_POINTS' ? '#facc15' : type === 'BONUS_TIME' ? '#38bdf8' : COLORS[Math.floor(Math.random() * COLORS.length)],
      size,
      letter: randomLetter,
      type
    };

    setCircles(prev => [...prev, newCircle]);

    // Cleanup circle after current speed duration
    setTimeout(() => {
      if (!isPaused) {
        setCircles(prev => prev.filter(c => c.id !== newCircle.id));
      }
    }, speed / gameSpeed);

    // Schedule next spawn
    spawnTimerRef.current = setTimeout(() => {
      spawnCircle();
    }, (speed / gameSpeed) * 0.8); // Slight overlap for continuity
  }, [isGameRunning, isPaused, speed, dimensions, difficulty, gameSpeed]);

  // Circle movement logic (falling)
  useEffect(() => {
    if (!isGameRunning || isPaused) return;

    let lastTime = performance.now();
    const moveStep = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      if (deltaTime < 100) { // Limit huge jumps if tab was inactive
        const baselineVelocity = 1200 / speed;
        setCircles(prev => prev.map(circle => ({
          ...circle,
          y: circle.y + (0.2 * baselineVelocity * gameSpeed * (deltaTime / 16.67))
        })));
      }

      rafMovementRef.current = requestAnimationFrame(moveStep);
    };

    rafMovementRef.current = requestAnimationFrame(moveStep);
    return () => {
      if (rafMovementRef.current) cancelAnimationFrame(rafMovementRef.current);
    };
  }, [isGameRunning, isPaused, gameSpeed]);

  useEffect(() => {
    if (isGameRunning && !isPaused) {
      spawnCircle();
    }
    return () => {
      if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    };
  }, [isGameRunning, isPaused, spawnCircle]);

  const handleTap = useCallback((circle: Circle, isKeyboard = false, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isPaused) return;
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTime.current;
    
    // Update combo
    let newCombo = comboRef.current;
    const comboWindow = 1000 * (sensitivity * 0.833); // Normal sensitivity 1.2 -> 1000ms. 0.8 -> ~666ms. 2.5 -> ~2080ms.
    if (timeSinceLastTap < comboWindow) {
      newCombo = newCombo + 1;
    } else {
      newCombo = 1;
    }
    setCombo(newCombo);
    setMaxCombo(prev => Math.max(prev, newCombo));
    comboRef.current = newCombo;
    lastTapTime.current = now;

    const multiplier = DIFFICULTY_SETTINGS[difficulty].multiplier;
    setScore(prev => {
      let bonus = 1;
      if (circle.type === 'BONUS_POINTS') bonus = 10;
      const points = bonus * multiplier;
      const next = prev + points;
      scoreRef.current = next;
      return next;
    });

    if (circle.type === 'BONUS_TIME') {
      setTimeLeft(prev => prev + 5);
    }

    if (circle.type !== 'NORMAL') {
      setIsBonusHit(true);
      setTimeout(() => setIsBonusHit(false), 300);
    }

    setLastHitColor(circle.color);
    setCircles(prev => prev.filter(c => c.id !== circle.id));
    
    // Play sound logic
    if (circle.type !== 'NORMAL') {
      playBonusSound();
    } else {
      // Regular tap sound with dynamic frequency
      const now = Date.now();
      const currentScore = scoreRef.current;
      const isMilestone = currentScore % 10 === 0;
      
      if (isMilestone) playComboMilestoneSound();

      // Determine waveform and volume based on difficulty
      const waveform = WAVEFORMS[difficulty];
      const tapVolume = difficulty === 'HARD' ? 0.05 : 0.1;
      const tapDuration = 0.15;

      const freqBoost = Math.min(newCombo * 10, 200);
      const baseFreq = COLOR_FREQ_BASE[circle.color] || 440;
      
      const jitterFactor = 0.95 + (Math.random() * 0.1);
      const finalFreq = (baseFreq + freqBoost) * jitterFactor;

      if (soundSettings.tap) {
        playSound(finalFreq, waveform, tapDuration, tapVolume, true);
      }
    }

    // Create effect
    const currentScore = scoreRef.current;
    const isBonus = currentScore % 5 === 0 || circle.type !== 'NORMAL';
    const pointsGained = (circle.type === 'BONUS_POINTS' ? 10 : 1) * multiplier;
    let word = isBonus 
      ? FEEDBACK_WORDS[Math.floor(Math.random() * FEEDBACK_WORDS.length)] 
      : (newCombo > 5 ? `${newCombo}x COMBO!` : `+${pointsGained}`);
    
    if (circle.type === 'BONUS_POINTS') word = `+${pointsGained} BONUS!`;
    if (circle.type === 'BONUS_TIME') word = "+5s TIME!";
    
    const particleCount = circle.type !== 'NORMAL' ? 50 : 10 + Math.min(newCombo * 2, 20);
    const particles: Particle[] = Array.from({ length: particleCount }).map((_, i) => {
      const angle = (Math.random() * 360) * (Math.PI / 180);
      const isBonus = circle.type !== 'NORMAL';
      const dist = (isBonus ? 50 : 30) + Math.random() * (isBonus ? 80 : (40 + newCombo * 5));
      return {
        id: i,
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist,
        size: (isBonus ? 4 : 2) + Math.random() * (isBonus ? 6 : 4)
      };
    });

    const newEffect: TapEffect = {
      id: nextEffectId.current++,
      x: circle.x,
      y: circle.y,
      text: word,
      color: circle.color,
      particles,
      isKeyboard,
      type: circle.type
    };
    setEffects(prev => [...prev, newEffect]);
    setTimeout(() => {
      setEffects(prev => prev.filter(e => e.id !== newEffect.id));
    }, 800);

    setSpeed(prev => Math.max(400, prev - 20));
  }, [difficulty, playBonusSound, playComboMilestoneSound, playSound]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isGameRunning) {
        togglePause();
        return;
      }

      if (!isGameRunning || isMobileMode || isPaused) return;
      
      const key = e.key.toUpperCase();
      // Find the first (oldest) circle with this letter for better gameplay (prioritize older ones)
      const targetCircle = circles.find(c => c.letter === key);
      
      if (targetCircle) {
        playKeyboardTapSound();
        handleTap(targetCircle, true);
        setIsKeyboardHit(true);
        setLastKey(key);
        setTimeout(() => {
          setIsKeyboardHit(false);
          setLastKey("");
        }, 200); // Slightly longer feedback
      } else if (/^[A-Z]$/.test(key)) {
        // Only play miss sound if it's an actual letter key and not matched
        playMissSound();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGameRunning, isPaused, circles, handleTap, playMissSound, isMobileMode]);

  return (
    <div 
      className={`min-h-screen ${THEMES[theme].bg} text-white font-sans flex flex-col items-center p-4 overflow-x-hidden select-none transition-colors duration-500 relative`}
      onClick={() => isGameRunning && !isPaused && playMissSound()}
    >
      {/* Dynamic Reactive Background Layer */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 opacity-40">
        {/* Animated Radial Gradients */}
        <motion.div 
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.3, 0.1],
          }}
          transition={{
            duration: difficulty === 'HARD' ? 3 : 5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] rounded-full blur-[120px]"
          style={{ backgroundColor: THEMES[theme].primary }}
        />
        <motion.div 
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.1, 0.2, 0.1],
          }}
          transition={{
            duration: difficulty === 'HARD' ? 4 : 7,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] rounded-full blur-[120px]"
          style={{ backgroundColor: THEMES[theme].secondary }}
        />

        {/* Reactive Grid Lines */}
        <div 
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(${THEMES[theme].primary}10 1px, transparent 1px), linear-gradient(90deg, ${THEMES[theme].primary}10 1px, transparent 1px)`,
            backgroundSize: `${80 / gameSpeed}px ${80 / gameSpeed}px`,
            transform: `perspective(1000px) rotateX(65deg) translateY(${(score * 2) % (80 / gameSpeed)}px)`,
            transition: "transform 0.4s ease-out, background-size 0.8s ease-in-out"
          }}
        />

        {/* Floating Geometric Elements */}
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={`geo-${i}`}
              className="absolute pointer-events-none"
              style={{
                left: `${(i * 15 + 10) % 100}%`,
                top: `${(i * 25 + 5) % 100}%`,
                opacity: 0.15,
              }}
              animate={{
                y: [0, -30, 0],
                x: [0, 20, 0],
                rotate: [0, 180, 360],
                scale: isGameRunning ? [1, 1.2, 1] : 1
              }}
              transition={{
                duration: 20 + i * 5,
                repeat: Infinity,
                ease: "linear",
                scale: {
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }
              }}
            >
              <svg width="120" height="120" viewBox="0 0 100 100" fill="none">
                {i % 3 === 0 ? (
                  <path d="M50 10L85 80H15L50 10Z" stroke={THEMES[theme].primary} strokeWidth="1" strokeDasharray="4 4" />
                ) : i % 3 === 1 ? (
                  <circle cx="50" cy="50" r="35" stroke={THEMES[theme].secondary} strokeWidth="1" strokeDasharray="2 6" />
                ) : (
                  <rect x="20" y="20" width="60" height="60" stroke={THEMES[theme].primary} strokeWidth="0.8" transform={`rotate(${i * 45} 50 50)`} />
                )}
              </svg>
            </motion.div>
          ))}
        </div>

        {/* Dynamic Scanlines */}
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${THEMES[theme].primary} 3px)`,
            backgroundSize: "100% 4px"
          }}
        />

        {/* Ghost Circles that react to score */}
        <AnimatePresence>
          {score > 0 && score % 10 === 0 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 4, opacity: 0.1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5 }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border-2"
              style={{ borderColor: THEMES[theme].primary }}
            />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {showIntro && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center p-6 text-center overflow-hidden"
          >
            {/* Skip Intro Button */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              onClick={() => {
                playSound(440, 'sine', 0.1, 0.05, true);
                setShowIntro(false);
              }}
              className="absolute top-6 right-6 z-[110] flex items-center gap-2 px-5 py-2.5 bg-slate-900/50 hover:bg-slate-800 border border-white/5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-all group backdrop-blur-md"
            >
              Skip Intro
            </motion.button>

            {/* Background elements for intro */}
            <div className="absolute inset-0 pointer-events-none opacity-20">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ 
                    x: Math.random() * 100 + "%", 
                    y: Math.random() * 100 + "%", 
                    scale: 0.5 
                  }}
                  animate={{ 
                    y: [null, Math.random() * 100 + "%"],
                    opacity: [0.2, 0.5, 0.2]
                  }}
                  transition={{ 
                    duration: 5 + Math.random() * 10, 
                    repeat: Infinity,
                    ease: "linear" 
                  }}
                  className="absolute w-4 h-4 rounded-full bg-sky-500 blur-xl"
                />
              ))}
            </div>

            <AnimatePresence mode="wait">
              {introStep === 'TITLE' ? (
                <motion.div
                  key="title-step"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
                  className="relative z-10 flex flex-col items-center"
                >
                  <motion.div
                    animate={{ 
                      scale: [1, 1.05, 1],
                      rotate: [0, 2, -2, 0]
                    }}
                    transition={{ duration: 4, repeat: Infinity }}
                    className="relative mb-6 sm:mb-12"
                  >
                    <div className="absolute -inset-10 bg-sky-500/10 blur-[80px] rounded-full" />
                    <div className="bg-sky-500/10 p-8 sm:p-12 rounded-full border-4 border-sky-500/20 backdrop-blur-2xl relative z-10 mb-6 sm:mb-8 mx-auto w-fit">
                      <Zap size={60} className="sm:w-[120px] sm:h-[120px] text-sky-400 fill-current drop-shadow-[0_0_50px_rgba(56,189,248,0.6)]" />
                    </div>
                    <h1 className="text-3xl sm:text-8xl font-black italic tracking-tighter text-white uppercase drop-shadow-2xl">
                      TAP GAME <span style={{ color: THEMES[theme].primary }}>PRO</span>
                    </h1>
                    <div className="mt-2 sm:mt-4 text-slate-500 font-bold uppercase tracking-[0.3em] sm:tracking-[1em] text-[7px] sm:text-[10px]">
                      Elite Reflex Training
                    </div>
                    {highScore > 0 && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-6 flex items-center justify-center gap-2 text-amber-500 font-bold uppercase tracking-widest text-[10px]"
                      >
                        <Trophy size={12} className="fill-current" /> All-Time Record: {highScore}
                      </motion.div>
                    )}
                  </motion.div>

                  <motion.button 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    onClick={() => {
                      playSound(440, 'sine', 0.2, 0.05, true);
                      setIntroStep('SETUP');
                    }}
                    className="group relative px-8 sm:px-16 py-3.5 sm:py-5 rounded-full bg-white text-slate-950 font-black text-base sm:text-2xl uppercase italic tracking-tighter hover:bg-sky-400 hover:text-white transition-all shadow-[0_0_60px_rgba(255,255,255,0.1)] hover:shadow-sky-500/50 hover:scale-110 active:scale-95"
                  >
                    Initialize Setup
                  </motion.button>

                  <motion.button 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1 }}
                    onClick={() => setShowSettings(true)}
                    className="mt-6 flex items-center gap-2 text-slate-500 hover:text-white transition-all text-xs font-black uppercase tracking-widest"
                  >
                    <Settings size={14} /> Global Configuration
                  </motion.button>

                  {!isLeaderboardLoading && leaderboard.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1.2 }}
                      className="mt-8 sm:mt-12 w-full max-w-xs bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-[2rem] p-4 sm:p-6 space-y-3 sm:space-y-4 shadow-2xl"
                    >
                      <h3 className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] text-center flex items-center justify-center gap-2">
                        <Trophy size={12} className="text-amber-500 fill-current" /> Global Hall of Fame
                      </h3>
                      <div className="space-y-3">
                        {leaderboard.map((entry, idx) => (
                          <div key={entry.id || idx} className="flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                              <span className={`text-[10px] font-mono ${idx === 0 ? 'text-amber-500' : 'text-slate-600'}`}>
                                {idx === 0 ? '🏆' : `0${idx + 1}`}
                              </span>
                              <span className="text-xs font-black text-slate-300 truncate max-w-[120px] uppercase tracking-tighter italic">
                                {entry.playerName}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[8px] font-black uppercase tracking-tighter ${
                                entry.difficulty === 'HARD' ? 'text-rose-500' : 
                                entry.difficulty === 'MEDIUM' ? 'text-sky-500' : 'text-emerald-500'
                              }`}>
                                {entry.difficulty}
                              </span>
                              <span className="text-sm font-mono font-bold text-white group-hover:scale-110 transition-transform drop-shadow-[0_0_10px_rgba(56,189,248,0.3)]">
                                {entry.score}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="setup-step"
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  className="w-full max-w-lg relative z-10 space-y-10"
                >
                  <div className="space-y-1 sm:space-y-2 relative">
                    <button 
                      onClick={() => setIntroStep('TITLE')}
                      className="absolute -top-1 -left-4 p-2 text-slate-500 hover:text-white transition-colors"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <h2 className="text-2xl sm:text-5xl font-black text-white italic uppercase tracking-tighter ml-4">Configure Mission</h2>
                    <p className="text-slate-500 text-[8px] sm:text-xs font-bold uppercase tracking-[0.2em] sm:tracking-[0.4em] ml-5">Select your combat parameters</p>
                  </div>

                  <div className="bg-slate-900/50 p-6 sm:p-10 rounded-[2rem] sm:rounded-[3rem] border border-slate-800 backdrop-blur-md shadow-3xl space-y-6 sm:space-y-10">
                    <div className="space-y-2 sm:space-y-4">
                      <p className="text-left text-[8px] sm:text-[10px] text-slate-500 font-black uppercase tracking-widest ml-1 flex items-center gap-2">
                        <User size={10} className="text-amber-400" /> Agent Identity
                      </p>
                      <div className="relative">
                        <input 
                          type="text" 
                          maxLength={20}
                          value={playerName}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '');
                            setPlayerName(val);
                          }}
                          className="w-full bg-slate-950 border-2 border-slate-800 rounded-2xl py-3 sm:py-4 px-5 text-white font-black uppercase tracking-widest text-[10px] sm:text-xs focus:outline-none focus:border-amber-500 transition-all placeholder:text-slate-800"
                          placeholder="ASSIGN IDENTIFIER..."
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                          <Check size={14} className={playerName.length >= 2 ? "text-emerald-500" : "text-slate-800"} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 sm:space-y-4">
                      <p className="text-left text-[8px] sm:text-[10px] text-slate-500 font-black uppercase tracking-widest ml-1 flex items-center gap-2">
                        <Zap size={10} className="text-sky-400" /> Complexity Level
                      </p>
                      <div className="grid grid-cols-3 gap-2 sm:gap-3">
                        {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((level) => (
                          <button
                            key={level}
                            onClick={() => {
                              setDifficulty(level);
                              playSound(440 + (level === 'HARD' ? 200 : level === 'MEDIUM' ? 100 : 0), 'sine', 0.1, 0.05);
                            }}
                            className={`p-3 sm:p-5 rounded-2xl sm:rounded-3xl border-2 transition-all text-[8px] sm:text-xs font-black uppercase tracking-widest ${
                              difficulty === level 
                                ? 'bg-sky-500 border-sky-400 text-white shadow-xl shadow-sky-500/40 scale-105 sm:scale-110 z-10' 
                                : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                            }`}
                          >
                            {DIFFICULTY_SETTINGS[level].label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 sm:space-y-4">
                      <p className="text-left text-[8px] sm:text-[10px] text-slate-500 font-black uppercase tracking-widest ml-1 flex items-center gap-2">
                        <Timer size={10} className="text-amber-400" /> Operational Window
                      </p>
                      <div className="grid grid-cols-3 gap-2 sm:gap-3">
                        {[30, 60, 120].map((sec) => (
                          <button
                            key={sec}
                            onClick={() => {
                              setSessionDuration(sec);
                              playSound(330, 'sine', 0.1, 0.05);
                            }}
                            className={`p-3 sm:p-5 rounded-2xl sm:rounded-3xl border-2 transition-all text-[8px] sm:text-xs font-black uppercase tracking-widest ${
                              sessionDuration === sec 
                                ? 'bg-amber-500 border-amber-400 text-white shadow-xl shadow-amber-500/40 scale-105 sm:scale-110 z-10' 
                                : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                            }`}
                          >
                            {sec === 60 ? '1 Min' : sec === 120 ? '2 Min' : sec + 's'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        playStartSound();
                        setShowIntro(false);
                      }}
                      className="group w-full py-3.5 sm:py-6 rounded-2xl sm:rounded-[2rem] bg-white text-slate-950 font-black text-base sm:text-2xl italic tracking-tighter uppercase shadow-[0_20px_50px_rgba(255,255,255,0.1)] hover:shadow-emerald-500/60 hover:bg-emerald-400 hover:text-white transition-all flex items-center justify-center gap-2 sm:gap-3"
                    >
                      Lock In & Deploy <Play size={18} className="sm:w-6 sm:h-6 group-hover:translate-x-2 transition-transform" />
                    </motion.button>
                  </div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-[0.5em] font-medium">Built by <span className="text-slate-400">AI Studio Build</span></p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <header 
        className="w-full max-w-2xl px-4 py-2 sm:py-4 flex flex-col items-center gap-2 sm:gap-4 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full flex justify-between items-center">
          <div className="w-8 sm:w-10" /> {/* Spacer */}
          <motion.h1 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-2xl sm:text-4xl font-black tracking-tighter flex items-center gap-2 italic uppercase transition-colors duration-500"
            style={{ color: THEMES[theme].primary }}
          >
            <Zap className="fill-current w-5 h-5 sm:w-8 sm:h-8" /> Tap <span className="hidden sm:inline">Game</span> PRO
          </motion.h1>
          <div className="flex items-center gap-1 sm:gap-2">
            <button 
              onClick={toggleFullscreen}
              className="p-2 rounded-full hover:bg-slate-900 transition-colors text-slate-400 hover:text-white"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-full hover:bg-slate-900 transition-colors text-slate-400 hover:text-white"
              title="Settings"
            >
              <Settings size={20} />
            </button>
            <button 
              onClick={() => setShowHelp(!showHelp)}
              className={`p-2 rounded-full transition-all duration-300 ${showHelp ? 'text-white shadow-lg' : 'hover:bg-slate-900 text-slate-400 hover:text-white'}`}
              style={showHelp ? { backgroundColor: THEMES[theme].primary } : {}}
              title="How to Play"
            >
              <Zap size={20} className={showHelp ? 'animate-pulse' : ''} />
            </button>
            <button 
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 rounded-full hover:bg-slate-900 transition-colors text-slate-400 hover:text-white"
            >
              {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
          </div>
        </div>

        <div className="w-full grid grid-cols-2 xs:grid-cols-4 gap-1 sm:gap-2 text-center bg-slate-900/50 p-1.5 sm:p-4 rounded-2xl border border-slate-800 backdrop-blur-sm shadow-xl">
          <div className="flex flex-col items-center relative py-1 xs:py-0">
            <AnimatePresence mode="popLayout">
              {combo > 1 && (
                <motion.div
                  key={combo}
                  initial={{ scale: 0.8, opacity: 0, y: 5 }}
                  animate={{ 
                    scale: combo > 50 ? [1, 1.3, 1] : 1, 
                    opacity: 1, 
                    y: 0,
                    filter: combo > 25 ? `drop-shadow(0 0 8px ${THEMES[theme].primary})` : 'none'
                  }}
                  exit={{ scale: 1.2, opacity: 0, y: -15 }}
                  transition={{ duration: 0.2, type: "spring", stiffness: 400, damping: 10 }}
                  className="absolute -top-7 sm:top-8 left-1/2 -translate-x-1/2 whitespace-nowrap z-20"
                >
                  <div className={`px-2 py-0.5 rounded-full border backdrop-blur-sm transition-colors duration-300 ${
                    combo > 50 ? 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.4)]' :
                    combo > 20 ? 'bg-amber-500/20 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]' :
                    'bg-sky-500/10 border-sky-500/30 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                  }`}>
                    <span className={`text-[8px] sm:text-[10px] font-black tracking-tighter uppercase italic transition-colors ${
                      combo > 50 ? 'text-rose-400' : combo > 20 ? 'text-amber-400' : 'text-sky-400'
                    }`}>
                      {combo}x <span className="text-[6px] sm:text-[8px]">{combo > 50 ? 'GIGA' : combo > 20 ? 'HOT' : 'HIT'}</span>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-slate-500 font-bold">Score</span>
            <motion.span 
              animate={{ 
                scale: [1, combo > 10 ? 1.1 : 1.05, 1],
                textShadow: combo > 30 ? `0 0 15px ${THEMES[theme].primary}` : "none"
              }}
              key={score}
              transition={{ duration: 0.15 }}
              className="text-xl sm:text-2xl font-mono font-bold transition-colors duration-500" 
              style={{ color: THEMES[theme].primary }}
            >
              {score}
            </motion.span>
          </div>
          <div className="flex flex-col items-center border-l xs:border-l border-slate-800 px-2 sm:px-4 py-1 xs:py-0">
            <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1">
              <Timer size={8} className="sm:w-[10px]" /> Time
            </span>
            <motion.span 
              animate={{ 
                scale: timeLeft <= 5 ? [1, 1.15, 1] : 1,
                color: timeLeft <= 5 ? '#f43f5e' : (timeLeft <= 10 ? '#fbbf24' : '#10b981')
              }}
              transition={{ 
                repeat: timeLeft <= 5 ? Infinity : 0, 
                duration: timeLeft <= 5 ? 0.4 : 1,
                ease: "easeInOut"
              }}
              className="text-xl sm:text-2xl font-mono font-bold"
            >
              {timeLeft}s
            </motion.span>
          </div>
          <div className="flex flex-col items-center border-t xs:border-t-0 xs:border-l border-slate-800 px-2 sm:px-4 py-1 xs:py-0">
            <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1">
              <Activity size={8} className="sm:w-[10px]" /> Speed
            </span>
            <motion.span 
              animate={{ 
                scale: gameSpeed > 1.5 ? [1, 1.1, 1] : 1,
              }}
              className="text-xl sm:text-2xl font-mono font-bold text-rose-400"
            >
              {((1200 / speed) * gameSpeed).toFixed(1)}x
            </motion.span>
          </div>
          <div className="flex flex-col items-center border-t border-l xs:border-t-0 xs:border-l border-slate-800 px-2 sm:px-4 py-1 xs:py-0">
            <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1">
              <Trophy size={8} className="sm:w-[10px]" /> Best
            </span>
            <div className="flex flex-col items-center">
              <span className="text-xl sm:text-2xl font-mono font-bold text-amber-400">{highScore}</span>
            </div>
          </div>
        </div>

        {!isGameRunning && (
          <div className="flex flex-col items-center gap-3 w-full">
            <div className="w-full flex flex-wrap justify-center gap-2">
              <div className="flex bg-slate-900/80 p-1.5 rounded-full border border-slate-800 shadow-inner">
                <button
                  onClick={() => setIsMobileMode(false)}
                  className={`px-4 sm:px-6 py-1.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1 sm:gap-2 ${
                    !isMobileMode
                      ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Zap size={10} className={!isMobileMode ? 'fill-current' : ''} />
                  Keys
                </button>
                <button
                  onClick={() => setIsMobileMode(true)}
                  className={`px-4 sm:px-6 py-1.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1 sm:gap-2 ${
                    isMobileMode
                      ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Zap size={10} className={isMobileMode ? 'fill-current' : ''} />
                  Touch
                </button>
              </div>

              <div className="flex gap-1.5 sm:gap-2 items-center bg-slate-900/40 p-1.5 rounded-full border border-slate-800/50">
                {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => setDifficulty(level)}
                    className={`px-3.5 sm:px-4 py-1.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all ${
                      difficulty === level
                        ? `${DIFFICULTY_SETTINGS[level].color.replace('text-', 'bg-').replace('-400', '-500')} text-white shadow-lg`
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {level[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-2 sm:gap-3">
          <button 
            onClick={startGame}
            disabled={isGameRunning}
            className={`flex items-center gap-2 px-6 sm:px-8 py-2 sm:py-3 rounded-full font-bold text-base sm:text-lg transition-all shadow-lg active:scale-95 duration-500 ${
              isGameRunning 
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50' 
                : 'text-white hover:opacity-90'
            }`}
            style={!isGameRunning ? { backgroundColor: THEMES[theme].primary } : {}}
          >
            {score > 0 && !isGameRunning ? <RotateCcw size={18} /> : <Play size={18} />}
            {isGameRunning ? (isPaused ? 'Game Paused' : 'Game Running...') : score > 0 ? 'Retry' : 'Start Game'}
          </button>
          
          {!isGameRunning && !isMobileMode && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="group relative px-4 py-1.5 rounded-full bg-slate-900/50 border border-slate-800/50 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 cursor-help"
            >
              <kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">A-Z</kbd>
              <span>Keyboard Controls Enabled</span>
              <Info size={12} className="text-slate-600 transition-colors group-hover:text-sky-400" />
              
              {/* Tooltip */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 p-3 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all pointer-events-none z-50 origin-top">
                <div className="text-[10px] text-sky-400 font-black mb-1 flex items-center gap-1.5">
                  <Zap size={10} className="fill-current" /> ELITE CONTROLS
                </div>
                <p className="text-[9px] text-slate-400 font-bold normal-case leading-relaxed tracking-normal">
                  Type the letters appearing on screen to instant-tap targets. Perfect for high-speed precision sessions.
                </p>
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 border-t border-l border-slate-800 rotate-45" />
              </div>
            </motion.div>
          )}
        </div>

        {isGameRunning && (
          <div className="flex gap-2 sm:gap-3 mt-2 animate-in fade-in slide-in-from-top-2 duration-500 w-full xs:w-auto px-4 xs:px-0">
            <button
              onClick={togglePause}
              id="pauseButton"
              className={`flex-1 xs:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-2.5 rounded-2xl border font-black transition-all text-[10px] uppercase tracking-[0.2em] shadow-xl min-h-[44px] ${
                isPaused 
                  ? 'bg-emerald-500 border-transparent text-white animate-pulse' 
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {isPaused ? <Play size={14} className="fill-current" /> : <div className="flex gap-1"><div className="w-1 h-3 bg-current rounded-full"/><div className="w-1 h-3 bg-current rounded-full"/></div>}
              <span className="hidden xs:inline">{isPaused ? 'Resume Game' : 'Pause Game'}</span>
              <span className="xs:hidden">{isPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              onClick={stopGameEarly}
              id="stopButton"
              className="flex-1 xs:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 font-black hover:bg-rose-500 hover:text-white transition-all text-[10px] uppercase tracking-[0.2em] shadow-xl min-h-[44px]"
            >
              <div className="w-3 h-3 bg-current rounded-sm" />
              <span className="hidden xs:inline">Stop Game</span>
              <span className="xs:hidden">Stop</span>
            </button>
          </div>
        )}
      </header>

      {/* Game Area */}
      <div 
        id="gameArea"
        ref={gameAreaRef}
        onClick={(e) => {
          e.stopPropagation();
          if (isGameRunning && !isPaused) playMissSound();
        }}
        className={`relative w-full max-w-2xl h-[55vh] md:h-[60vh] lg:h-[65vh] max-h-[800px] bg-slate-900 border-2 rounded-3xl overflow-hidden mt-1 sm:mt-2 shadow-inner transition-all duration-75 touch-none ${
          isBonusHit
            ? 'border-amber-400 shadow-[0_0_50px_rgba(251,191,36,0.5)] scale-[1.01]'
            : isKeyboardHit 
              ? 'border-sky-400 shadow-[0_0_30px_rgba(56,189,248,0.4)] scale-[1.002]' 
              : isMissed 
                ? 'border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]' 
                : 'border-slate-800 shadow-none'
        }`}
      >
        {/* Progress Bar Timer */}
        {isGameRunning && (
          <div className="absolute top-0 left-0 w-full h-1 bg-slate-800 z-20 overflow-hidden">
            <motion.div 
              className={`h-full ${timeLeft <= 5 ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.5)]'}`}
              initial={{ width: '100%' }}
              animate={{ width: `${(timeLeft / sessionDuration) * 100}%` }}
              transition={{ duration: 1, ease: "linear" }}
            />
          </div>
        )}

        {/* Difficulty Scale-up Notification */}
        <AnimatePresence>
          {difficultyMessage && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.5, y: -50 }}
              className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none px-4"
            >
              <div className="bg-white/10 backdrop-blur-md border-2 border-white/20 px-8 py-4 rounded-3xl shadow-[0_0_50px_rgba(255,255,255,0.2)]">
                <h2 className="text-2xl sm:text-4xl font-black text-white italic tracking-tighter uppercase text-center drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
                  {difficultyMessage}
                </h2>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isPaused && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto"
              onClick={togglePause}
            >
              <div className="text-center space-y-4">
                <h2 className="text-6xl font-black text-white italic tracking-tighter uppercase drop-shadow-2xl">Paused</h2>
                <div className="bg-sky-500 text-white px-6 py-2 rounded-full font-bold text-sm uppercase tracking-widest animate-bounce">
                  Click to Resume
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showHelp && !isGameRunning && (
            <motion.div
              initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
              animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
              exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
              className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/60"
              onClick={() => setShowHelp(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-slate-900 border border-slate-700 p-8 rounded-[2rem] shadow-2xl max-w-sm w-full space-y-6"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-black text-sky-400 italic uppercase">Pro Guide</h3>
                  <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-white transition-colors">
                    <RotateCcw size={16} />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="bg-sky-500/10 p-3 rounded-2xl text-sky-500 h-fit">
                      <Zap size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-white uppercase text-xs tracking-widest mb-1 text-sky-400">Lightning Typing</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">Each circle spawns with a unique letter. Press that key on your keyboard to clear it instantly. This is the fastest way to build high-score combos!</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="bg-emerald-500/10 p-3 rounded-2xl text-emerald-500 h-fit">
                      <Play size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-white uppercase text-xs tracking-widest mb-1 text-emerald-400">Click & Tap</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">Prefer the mouse? No problem. Clicking works exactly the same. Mix both styles to find your perfect rhythm.</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="bg-indigo-500/10 p-3 rounded-2xl text-indigo-500 h-fit">
                      <Zap size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-white uppercase text-xs tracking-widest mb-1 text-indigo-400">Mobile Mode</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">Turn on Mobile Mode to hide letters and focus entirely on tapping. Perfect for phone screens and quick reflexes!</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="bg-amber-500/10 p-3 rounded-2xl text-amber-500 h-fit">
                      <Trophy size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-white uppercase text-xs tracking-widest mb-1 text-amber-400">Difficulty Sync</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">Harder difficulties reset your time faster but give you significantly more points and more aggressive soundscapes.</p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowHelp(false)}
                  className="w-full bg-slate-800 hover:bg-sky-500 text-white font-bold py-3 rounded-2xl transition-all uppercase tracking-widest text-xs"
                >
                  Got it!
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
              onClick={() => setShowSettings(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-slate-900 border border-slate-800 p-5 sm:p-8 rounded-[2rem] shadow-2xl max-w-md w-full space-y-6 sm:space-y-8 max-h-[90vh] overflow-y-auto custom-scrollbar"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-1 sm:mb-2">
                  <h3 className="text-xl sm:text-2xl font-black text-white italic uppercase tracking-tighter flex items-center gap-2">
                    <Settings className="text-sky-400" /> Settings
                  </h3>
                  <button 
                    onClick={() => setShowSettings(false)} 
                    className="p-2 rounded-full hover:bg-slate-800 text-slate-500 hover:text-white transition-all scale-90 sm:scale-100"
                  >
                    <RotateCcw size={20} />
                  </button>
                </div>

                <div className="space-y-5 sm:space-y-6">
                  {/* Agent Identity */}
                  <div className="space-y-3 sm:space-y-4">
                    <p className="text-[9px] sm:text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                      <User size={12} className="text-amber-400" /> Agent Identity
                    </p>
                    {user ? (
                      <div className="flex items-center gap-3 bg-slate-950 p-2.5 sm:p-3 rounded-2xl border border-slate-800">
                        <img src={user.photoURL || ''} className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                        <div>
                          <p className="text-[9px] sm:text-[10px] text-white font-black uppercase tracking-widest">{user.displayName}</p>
                          <button onClick={() => auth.signOut()} className="text-[8px] text-slate-500 hover:text-white uppercase font-bold">Logout</button>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={handleSignIn}
                        className="w-full bg-white text-slate-900 py-3 rounded-2xl font-black uppercase tracking-widest text-[9px] sm:text-[10px] flex items-center justify-center gap-2 hover:bg-slate-200 transition-all shadow-lg active:scale-95"
                      >
                        <Zap size={14} className="fill-current" /> Sign in with Google
                      </button>
                    )}
                    <input 
                      type="text" 
                      maxLength={20}
                      value={playerName}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '');
                        setPlayerName(val);
                      }}
                      className="w-full bg-slate-950 border-2 border-slate-800 rounded-2xl py-3 px-4 text-white font-black uppercase tracking-widest text-[9px] sm:text-[10px] focus:outline-none focus:border-amber-500 transition-all placeholder:text-slate-800"
                      placeholder="SET PLAYER NAME..."
                    />
                  </div>

                  {/* Difficulty Selection */}
                  <div className="space-y-3 sm:space-y-4">
                    <p className="text-[9px] sm:text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                      <Zap size={12} className="text-sky-400" /> Game Difficulty
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((level) => (
                        <button
                          key={level}
                          onClick={() => {
                            setDifficulty(level);
                            playSound(440 + (level === 'HARD' ? 200 : level === 'MEDIUM' ? 100 : 0), 'sine', 0.1, 0.05);
                          }}
                          disabled={isGameRunning}
                          className={`py-2.5 sm:py-3 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-0.5 sm:gap-1 text-[8px] font-black uppercase tracking-widest ${
                            difficulty === level 
                              ? `${DIFFICULTY_SETTINGS[level].color.replace('text-', 'bg-').replace('-400', '-500')} border-transparent text-white shadow-lg` 
                              : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                          } ${isGameRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {DIFFICULTY_SETTINGS[level].label}
                          <span className="opacity-60 text-[6px]">{DIFFICULTY_SETTINGS[level].multiplier}x Points</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Volume Control */}
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-[9px] sm:text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                        <Sliders size={12} className="text-amber-400" /> Audio Calibration
                      </p>
                      <span className="text-[9px] sm:text-[10px] font-mono text-amber-500">{Math.round(volume * 100)}%</span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4">
                      <button 
                        onClick={() => setIsMuted(!isMuted)}
                        className="p-2 sm:p-2.5 bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                      >
                        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                      </button>
                      <input 
                        type="range" 
                        min="0" 
                        max="2" 
                        step="0.01" 
                        value={volume} 
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>
                    
                    {/* Individual Sound Toggles */}
                    <div className="grid grid-cols-2 gap-1.5 sm:gap-2 mt-2">
                      {[
                        { id: 'tap', label: 'Taps', icon: <Star size={10} /> },
                        { id: 'bonus', label: 'Bonuses', icon: <Zap size={10} /> },
                        { id: 'miss', label: 'Misses', icon: <VolumeX size={10} /> },
                        { id: 'combo', label: 'Streaks', icon: <Trophy size={10} /> }
                      ].map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            const newSettings = { ...soundSettings, [s.id]: !soundSettings[s.id as keyof typeof soundSettings] };
                            setSoundSettings(newSettings);
                            if (newSettings[s.id as keyof typeof soundSettings]) {
                              playSound(s.id === 'miss' ? 60 : 440, 'sine', 0.1, 0.05);
                            }
                          }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-[8px] font-black uppercase tracking-widest min-h-[38px] ${
                            soundSettings[s.id as keyof typeof soundSettings]
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                              : 'bg-slate-950 border-slate-800 text-slate-600'
                          }`}
                        >
                          {s.icon}
                          {s.label}
                          {soundSettings[s.id as keyof typeof soundSettings] && <Check size={8} className="ml-auto" />}
                        </button>
                      ))}
                    </div>
                  </div>


                  {/* Tap Sensitivity */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                        <Zap size={12} className="text-emerald-400" /> Tap Sensitivity
                      </p>
                      <span className="text-[10px] font-mono text-emerald-500">{Math.round((sensitivity - 0.5) * 50)}%</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range" 
                        min="0.8" 
                        max="2.5" 
                        step="0.1" 
                        value={sensitivity} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setSensitivity(val);
                        }}
                        className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    <p className="text-[8px] text-slate-600 font-bold uppercase tracking-wider">
                      Higher sensitivity increases the hit area for circles.
                    </p>
                  </div>

                  {/* Global Game Speed */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                        <Activity size={12} className="text-rose-400" /> Global Game Speed
                      </p>
                      <span className="text-[10px] font-mono text-rose-500">{gameSpeed.toFixed(1)}x</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range" 
                        min="0.5" 
                        max="2.5" 
                        step="0.1" 
                        value={gameSpeed} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setGameSpeed(val);
                        }}
                        className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
                      />
                    </div>
                    <p className="text-[8px] text-slate-600 font-bold uppercase tracking-wider">
                      Adjusts both circle spawn rate and fall velocity. Multiplies the baseline difficulty settings.
                    </p>
                  </div>

                  {/* Device Sync */}
                  <div className="space-y-4">
                    <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                      <Maximize size={12} className="text-sky-400" /> Display Mode
                    </p>
                    <button
                      onClick={toggleFullscreen}
                      className={`w-full py-3 rounded-2xl border-2 transition-all flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest ${
                        isFullscreen 
                          ? 'bg-sky-500 border-sky-400 text-white shadow-lg shadow-sky-500/20' 
                          : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                      }`}
                    >
                      {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                      {isFullscreen ? 'Exit Fullscreen' : 'Enable Fullscreen'}
                    </button>
                  </div>

                  {/* Device Sync */}
                  <div className="space-y-4">
                    <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                      <Zap size={12} className="text-indigo-400" /> Interaction Mode
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setIsMobileMode(false)}
                        className={`py-3 rounded-2xl border-2 transition-all flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest ${
                          !isMobileMode 
                            ? 'bg-sky-500 border-sky-400 text-white shadow-lg shadow-sky-500/20' 
                            : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}
                      >
                        Desktop (Keys)
                      </button>
                      <button
                        onClick={() => setIsMobileMode(true)}
                        className={`py-3 rounded-2xl border-2 transition-all flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest ${
                          isMobileMode 
                            ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/20' 
                            : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}
                      >
                        Mobile (Touch)
                      </button>
                    </div>
                    
                    {!isMobileMode && (
                      <div className="flex items-center justify-between bg-slate-950/50 p-3 rounded-2xl border border-slate-800/50">
                        <div className="flex items-center gap-2">
                          <Info size={12} className="text-sky-400" />
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Show Keyboard Hints</p>
                        </div>
                        <button 
                          onClick={() => setShowKeyHints(!showKeyHints)}
                          className={`w-10 h-5 rounded-full relative transition-colors ${showKeyHints ? 'bg-sky-500' : 'bg-slate-800'}`}
                        >
                          <motion.div 
                            animate={{ x: showKeyHints ? 22 : 2 }}
                            className="absolute top-1 left-0 w-3 h-3 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Visual Interface */}
                  <div className="space-y-4">
                    <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2">
                      <Palette size={12} className="text-emerald-400" /> Visual Interface
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.keys(THEMES) as Theme[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setTheme(t);
                            playSound(660, 'sine', 0.1, 0.05);
                          }}
                          className={`p-3 rounded-2xl border-2 transition-all flex items-center gap-3 ${
                            theme === t 
                              ? 'bg-slate-800 border-white/20 text-white' 
                              : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                          }`}
                        >
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: THEMES[t].primary }}
                          />
                          <span className="text-[10px] font-black uppercase tracking-widest">{THEMES[t].name}</span>
                          {theme === t && <Check size={12} className="ml-auto text-emerald-400" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="w-full bg-white text-slate-950 font-black py-4 rounded-2xl transition-all uppercase tracking-[0.2em] text-xs hover:bg-sky-400 hover:text-white active:scale-95"
                  >
                    Apply Configurations
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isKeyboardHit && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 0.15, scale: 1.2 }}
              exit={{ opacity: 0, scale: 1.5 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none z-0"
            >
              <span 
                className="text-[30vw] font-black select-none opacity-20"
                style={{ color: lastHitColor }}
              >
                {lastKey}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!isMobileMode && isGameRunning && (
            <div className="absolute top-4 left-4 flex flex-col gap-1.5 z-10">
              <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1 rounded-full border border-sky-500/30 text-[10px] font-black text-sky-400 uppercase tracking-widest animate-pulse backdrop-blur-sm">
                <Zap size={10} className="fill-current" /> Keyboard Control Active
              </div>
            </div>
          )}

          {isGameRunning && (
            <div className="absolute top-4 right-6 flex flex-col items-end pointer-events-none z-30">
              <AnimatePresence mode="wait">
                {combo > 1 && (
                  <motion.div
                    key="combo-badge"
                    initial={{ scale: 0, x: 20, rotate: 10, opacity: 0 }}
                    animate={{ 
                      scale: 1 + Math.min(combo * 0.01, 0.4), 
                      x: 0, 
                      rotate: 0,
                      opacity: 1
                    }}
                    exit={{ scale: 0.5, x: 20, opacity: 0 }}
                    className="flex flex-col items-end group"
                  >
                    <div className="relative">
                      <motion.div 
                        key={combo}
                        initial={{ scale: 1.5, filter: 'brightness(2)' }}
                        animate={{ 
                          scale: 1, 
                          filter: 'brightness(1)',
                          y: combo % 10 === 0 ? [0, -20, 0] : 0
                        }}
                        transition={{ 
                          type: "spring", 
                          stiffness: 400, 
                          damping: 10,
                          y: { duration: 0.4 }
                        }}
                        className={`text-5xl sm:text-7xl font-black italic tracking-tighter select-none transition-colors duration-300 ${
                          combo >= 50 ? 'text-rose-500 drop-shadow-[0_0_25px_rgba(244,63,94,0.6)]' : 
                          combo >= 25 ? 'text-amber-400 drop-shadow-[0_0_20px_rgba(251,191,36,0.5)]' : 
                          'text-sky-400 drop-shadow-[0_0_15px_rgba(56,189,248,0.4)]'
                        }`}
                      >
                        {combo}
                        <span className="text-2xl sm:text-3xl ml-1 not-italic">×</span>
                      </motion.div>
                      
                      {/* Milestone Flash */}
                      {combo % 10 === 0 && (
                        <motion.div 
                          initial={{ scale: 0.8, opacity: 1 }}
                          animate={{ scale: 2, opacity: 0 }}
                          className="absolute inset-0 bg-white/30 blur-xl rounded-full"
                        />
                      )}
                    </div>
                    
                    <motion.div 
                      animate={{ 
                        opacity: combo >= 10 ? 1 : 0.6,
                        letterSpacing: combo >= 25 ? '0.5em' : '0.3em'
                      }}
                      className={`text-[8px] sm:text-[10px] font-black uppercase tracking-[0.3em] -mt-2 transition-all ${
                        combo >= 50 ? 'text-rose-400' : combo >= 25 ? 'text-amber-400' : 'text-slate-500'
                      }`}
                    >
                      {combo >= 50 ? 'UNSTOPPABLE!!' : combo >= 25 ? 'GODLIKE STREAK' : 'STREAK COMBO'}
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {circles.map((circle) => (
            <div
              key={circle.id}
              className="absolute z-20 flex items-center justify-center"
              onClick={(e) => handleTap(circle, false, e)}
              style={{
                left: circle.x + circle.size / 2,
                top: circle.y + circle.size / 2,
                width: circle.size * sensitivity,
                height: circle.size * sensitivity,
                transform: 'translate(-50%, -50%)',
                cursor: 'pointer'
              }}
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className={`w-full h-full rounded-full shadow-lg flex items-center justify-center ${
                  circle.type === 'BONUS_POINTS' ? 'ring-4 ring-amber-400 ring-offset-4 ring-offset-slate-900 border-4 border-amber-300' : 
                  circle.type === 'BONUS_TIME' ? 'ring-4 ring-sky-400 ring-offset-4 ring-offset-slate-900 border-4 border-sky-300' : ''
                }`}
                style={{
                  width: circle.size,
                  height: circle.size,
                  backgroundColor: circle.color,
                  boxShadow: circle.type !== 'NORMAL' ? `0 0 40px ${circle.color}ee` : `0 0 20px ${circle.color}44`
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
              {circle.type !== 'NORMAL' && (
                <motion.div
                  className="absolute inset-0 rounded-full blur-[20px]"
                  style={{ backgroundColor: circle.color }}
                  animate={{
                    scale: [1, 1.4, 1],
                    opacity: [0.2, 0.5, 0.2]
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                />
              )}
              <div className="relative flex items-center justify-center w-full h-full z-10">
                {circle.type === 'BONUS_POINTS' && (
                  <Star 
                    size={circle.size * 0.5} 
                    className="text-white fill-current animate-pulse absolute" 
                  />
                )}
                {circle.type === 'BONUS_TIME' && (
                  <Clock 
                    size={circle.size * 0.5} 
                    className="text-white fill-current animate-spin-slow absolute" 
                  />
                )}
                <span 
                  className={`text-white font-black select-none drop-shadow-md pb-0.5 ${circle.type !== 'NORMAL' ? 'opacity-40 scale-75' : ''}`}
                  style={{ fontSize: circle.size * 0.4 }}
                >
                  {!isMobileMode && showKeyHints && circle.letter}
                </span>
                
                {!isMobileMode && showKeyHints && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute -bottom-4 bg-black/60 backdrop-blur-sm border border-white/20 rounded px-1.5 py-0.5 shadow-xl"
                  >
                    <span className="text-[8px] font-mono font-bold text-white tracking-widest leading-none">KEY:{circle.letter}</span>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </div>
        ))}
        </AnimatePresence>

        {effects.map((effect) => (
          <div 
            key={effect.id} 
            className="absolute pointer-events-none" 
            style={{ 
              left: effect.x, 
              top: effect.y, 
              width: 60, 
              height: 60 
            }}
          >
            {/* Particles Burst */}
            {effect.particles.map((p) => (
              <motion.div
                key={p.id}
                initial={{ x: 30, y: 30, scale: 1, opacity: 1 }}
                animate={{ 
                  x: [30, 30 + p.tx], 
                  y: [30, 30 + p.ty, 30 + p.ty + 40], 
                  scale: [1, 1, 0], 
                  opacity: [1, 1, 0] 
                }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute rounded-full"
                style={{
                  width: p.size,
                  height: p.size,
                  backgroundColor: effect.color,
                  boxShadow: effect.type !== 'NORMAL' ? `0 0 15px ${effect.color}, 0 0 30px ${effect.color}` : `0 0 10px ${effect.color}`
                }}
              />
            ))}
            
            {/* Keyboard Precision Feedback */}
            {effect.isKeyboard && (
              <motion.div
                initial={{ scale: 0.5, rotate: 0, opacity: 1 }}
                animate={{ scale: 1.5, rotate: 90, opacity: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="absolute inset-0 border-2 border-dashed rounded-lg"
                style={{ borderColor: effect.color }}
              />
            )}
            
            {/* Expanding Ring */}
            <motion.div
              initial={{ scale: 0.8, opacity: 1 }}
              animate={{ scale: 2.2, opacity: 0 }}
              className="absolute inset-0 rounded-full border-2"
              style={{ 
                borderColor: effect.color,
                boxShadow: `0 0 20px ${effect.color}88, inset 0 0 20px ${effect.color}88`
              }}
            />
            {/* Floating Word Effect */}
            <motion.div
              initial={{ y: -20, x: 0, opacity: 0, scale: 0.5, rotate: Math.random() * 20 - 10 }}
              animate={{ 
                y: [-40, -140, -160], 
                x: [0, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 60],
                opacity: [0, 1, 1, 0], 
                scale: [0.5, 1.6, 1.3],
                rotate: [Math.random() * 20 - 10, Math.random() * 30 - 15, Math.random() * 40 - 20]
              }}
              transition={{ duration: 0.8, times: [0, 0.1, 0.8, 1], ease: "easeOut" }}
              className="absolute inset-x-0 bottom-full flex items-center justify-center font-black text-4xl drop-shadow-[0_4px_15px_rgba(0,0,0,1)] italic tracking-tighter select-none whitespace-nowrap"
              style={{ 
                color: effect.color,
                textShadow: `0 0 25px ${effect.color}, 0 0 50px ${effect.color}44`
              }}
            >
              {effect.text}
            </motion.div>
          </div>
        ))}

        <AnimatePresence>
          {preGameCountdown !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-slate-950/20 backdrop-blur-[2px] flex items-center justify-center pointer-events-none"
            >
              <motion.div
                key={preGameCountdown}
                initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                animate={{ scale: 1.5, opacity: 1, rotate: 0 }}
                exit={{ scale: 3, opacity: 0, rotate: 20 }}
                className="text-8xl font-black text-sky-400 italic italic-none drop-shadow-[0_0_50px_rgba(56,189,248,0.5)]"
              >
                {preGameCountdown > 0 ? preGameCountdown : 'GO!'}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {!isGameRunning && preGameCountdown === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {timeLeft === 0 && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md z-[100] px-6"
              >
                <motion.div 
                  initial={{ scale: 0.8, y: 20, opacity: 0 }}
                  animate={{ scale: 1, y: 0, opacity: 1 }}
                  transition={{ type: "spring", damping: 20, stiffness: 300, delay: 0.1 }}
                  className="w-full max-w-md text-center"
                >
                  {/* Header Section */}
                  <motion.div
                    initial={{ y: -20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="mb-8"
                  >
                    <Trophy className="mx-auto text-amber-400 w-16 h-16 drop-shadow-[0_0_15px_rgba(251,191,36,0.5)] mb-4" />
                    <h2 className="text-4xl sm:text-6xl font-black text-rose-500 uppercase italic tracking-tighter drop-shadow-[0_0_20px_rgba(244,63,94,0.3)]">
                      Game Over
                    </h2>
                    <p className="text-slate-500 uppercase tracking-[0.3em] font-black text-xs mt-1">Session Complete</p>
                  </motion.div>

                  {/* Score Summary Card */}
                  <div className="bg-slate-900/50 border border-slate-800 rounded-[2rem] sm:rounded-[2.5rem] p-5 sm:p-8 mb-6 sm:mb-8 relative overflow-hidden backdrop-blur-sm shadow-2xl">
                    {score >= highScore && score > 0 && (
                      <motion.div 
                        initial={{ scale: 0, rotate: -20 }}
                        animate={{ scale: 1, rotate: -15 }}
                        className="absolute -top-1 -right-3 bg-amber-400 text-slate-950 text-[8px] sm:text-[10px] uppercase font-black px-4 sm:px-6 py-1.5 sm:py-2 rounded-full shadow-lg z-10 border-2 border-slate-900"
                      >
                        New Personal Best!
                      </motion.div>
                    )}
                    
                    <div className="flex flex-col gap-4 sm:gap-6">
                      <div>
                        <p className="text-slate-400 uppercase tracking-widest font-black text-[9px] sm:text-[10px] mb-1">Final Score</p>
                        <motion.p 
                          initial={{ scale: 0.5 }}
                          animate={{ scale: 1 }}
                          className="text-5xl sm:text-7xl font-black text-white italic drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                        >
                          {score}
                        </motion.p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-5 sm:pt-6 mt-1 sm:mt-2">
                        <div className="text-center">
                            <p className="text-slate-500 uppercase tracking-widest font-black text-[8px] sm:text-[9px] mb-1">High Score</p>
                            <p className="text-amber-400 font-black text-lg sm:text-xl">{highScore}</p>
                        </div>
                        <div className="text-center border-l border-slate-800">
                            <p className="text-slate-500 uppercase tracking-widest font-black text-[8px] sm:text-[9px] mb-1">Best Combo</p>
                            <motion.p 
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
                              className="text-sky-400 font-black text-lg sm:text-xl"
                            >
                              {maxCombo}x
                            </motion.p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-1 gap-3 sm:gap-4 w-full px-2 sm:px-4">
                    <div className="flex flex-col gap-2.5 sm:gap-3">
                      <button 
                        onClick={startGame}
                        className="w-full text-white px-8 py-4.5 sm:py-6 rounded-2xl sm:rounded-2xl font-black uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95 flex items-center justify-center gap-3 group relative overflow-hidden"
                        style={{ backgroundColor: THEMES[theme].primary }}
                      >
                        <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500" />
                        <RotateCcw size={18} className="group-hover:rotate-180 transition-transform duration-500 sm:w-5 sm:h-5" />
                        <span className="text-xs sm:text-base">Play Again</span>
                      </button>

                      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                        <button 
                          onClick={() => {
                            setShowIntro(true);
                            setIntroStep('TITLE');
                            setScore(0);
                            setCombo(0);
                            setMaxCombo(0);
                          }}
                          className="bg-slate-800 hover:bg-slate-700 text-white px-4 sm:px-6 py-3.5 sm:py-4 rounded-2xl font-black uppercase tracking-widest transition-all border border-slate-700 active:scale-95 flex items-center justify-center gap-2 text-[10px] sm:text-xs"
                        >
                          Menu
                        </button>
                        <button 
                          onClick={async () => {
                            const text = `I just scored ${score} in Tap Game Pro! Best: ${highScore}. Can you beat me?`;
                            if (navigator.share) {
                              try {
                                await navigator.share({
                                  title: 'Tap Game Pro Score',
                                  text: text,
                                  url: window.location.href
                                });
                              } catch (err) {
                                console.log('Error sharing:', err);
                              }
                            } else {
                              navigator.clipboard.writeText(text);
                              alert("Score copied to clipboard!");
                            }
                          }}
                          className="bg-white hover:bg-slate-100 text-slate-950 px-4 sm:px-6 py-3.5 sm:py-4 rounded-2xl font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 text-[10px] sm:text-xs"
                        >
                          Share <Zap size={14} className="fill-current sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    </div>


                    {!user && (
                      <button 
                        onClick={handleSignIn}
                        className="mt-2 text-sky-400 text-[10px] font-black uppercase tracking-[0.1em] hover:text-sky-300 transition-colors flex items-center justify-center gap-2"
                      >
                        <User size={12} /> Sign in to compete on leaderboard
                      </button>
                    )}

                    {highScore > 0 && (
                      <button 
                        onClick={resetHighScore}
                        className="text-[10px] text-slate-500 hover:text-rose-500 transition-colors uppercase font-bold tracking-widest mt-2"
                      >
                        Reset Statistics
                      </button>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
            {score === 0 && timeLeft > 0 && (
              <div className="flex flex-col items-center gap-6 p-10 text-center max-w-sm">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <p className="text-sky-400 font-black text-xl uppercase italic tracking-widest animate-pulse">Ready to Blitz?</p>
                  
                  <div className="bg-slate-900/80 border border-slate-700/50 p-6 rounded-3xl space-y-4 shadow-2xl">
                    <div className="flex items-center gap-4 text-left">
                      <div className="bg-sky-500/20 p-2 rounded-lg text-sky-400">
                        <Zap size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white">Keyboard Mode</p>
                        <p className="text-xs text-slate-400">Type the letter shown inside the circle to tap it instantly.</p>
                      </div>
                    </div>

                    <div className="h-px bg-slate-800" />

                    <div className="flex items-center gap-4 text-left">
                      <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-400">
                        <Play size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white">Classic Mode</p>
                        <p className="text-xs text-slate-400">Standard mouse clicks or screen taps also work perfectly.</p>
                      </div>
                    </div>

                    <div className="h-px bg-slate-800" />

                    <div className="flex items-center gap-4 text-left">
                      <div className="bg-indigo-500/20 p-2 rounded-lg text-indigo-400">
                        <Zap size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white">Mobile Mode</p>
                        <p className="text-xs text-slate-400">Optimized for phones. Hide letters and focus on pure tapping speed.</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
                <div className="p-2 bg-slate-800/30 rounded-xl border border-slate-700/30">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest leading-relaxed">
                    Higher Difficulty = Faster Spawns & Better Score Multipliers
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="mt-auto w-full max-w-2xl py-8 text-center text-slate-600 text-[10px] uppercase tracking-widest leading-loose">
        <div className="mb-4 flex justify-center gap-4 text-slate-500 font-bold bg-slate-900/30 p-2 rounded-lg border border-slate-800/50 relative">
          {!isMobileMode && <span className="flex items-center gap-1"><Zap size={10} /> Keyboard Typing Enabled (A-Z)</span>}
          <span className="flex items-center gap-1"><RotateCcw size={10} /> {isMobileMode ? 'Touch Screen Tapping Active' : 'Click to Tap'}</span>
          <AnimatePresence>
            {isKeyboardHit && (
              <motion.span 
                initial={{ opacity: 0, scale: 0.5, y: 10 }}
                animate={{ opacity: 1, scale: 1.2, y: -20 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute right-0 top-0 bg-sky-500 text-white px-2 py-0.5 rounded text-xs shadow-lg shadow-sky-500/50"
              >
                HIT: {lastKey}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <p>© 2026 Tap Game Pro • Master Your Reflexes</p>
        <p className="italic">Test your speed • Beat your record • Become a Pro</p>
        {/* AdSense Placeholder Area */}
        <div className="mt-4 border border-dashed border-slate-800 p-2 rounded opacity-30">
          AD PLACEMENT
        </div>
      </footer>
    </div>
  );
}

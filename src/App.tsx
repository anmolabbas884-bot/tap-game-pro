/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Timer, Play, RotateCcw, Zap, Volume2, VolumeX, Info } from 'lucide-react';

interface Circle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  letter: string;
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

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

const DIFFICULTY_SETTINGS: Record<Difficulty, { speed: number; label: string; color: string }> = {
  EASY: { speed: 1500, label: 'Easy', color: 'text-emerald-400' },
  MEDIUM: { speed: 1200, label: 'Medium', color: 'text-sky-400' },
  HARD: { speed: 800, label: 'Hard', color: 'text-rose-400' }
};

export default function App() {
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [isMuted, setIsMuted] = useState(false);
  const [combo, setCombo] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(30);
  const lastTapTime = useRef(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem("tapHighScore");
    return saved ? parseInt(saved, 10) : 0;
  });
  const [speed, setSpeed] = useState(1200);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [effects, setEffects] = useState<TapEffect[]>([]);
  const [isKeyboardHit, setIsKeyboardHit] = useState(false);
  const [lastHitColor, setLastHitColor] = useState("#38bdf8");
  const [isMissed, setIsMissed] = useState(false);
  const [isMobileMode, setIsMobileMode] = useState(() => {
    // Only detect if window is available (client-side)
    if (typeof window !== 'undefined') {
      return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
    }
    return false;
  });
  const [lastKey, setLastKey] = useState("");
  const [showIntro, setShowIntro] = useState(true);
  const [introStep, setIntroStep] = useState<'TITLE' | 'SETUP'>('TITLE');
  
  const [showHelp, setShowHelp] = useState(false);
  const [preGameCountdown, setPreGameCountdown] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const nextCircleId = useRef(0);
  const nextEffectId = useRef(0);
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
    musicGainRef.current.gain.setTargetAtTime(isMuted ? 0 : 0.04, ctx.currentTime, 0.5);

    let step = 0;
    const bpm = difficulty === 'HARD' ? 130 : difficulty === 'MEDIUM' ? 115 : 100;
    const stepDuration = 60 / bpm / 2; // 1/8 notes

    // Bass sequence: more atmospheric for electronic feel
    const bassSeq = difficulty === 'HARD' ? [40, 0, 0, 45, 0, 40, 50, 0] : [40, 0, 0, 0, 40, 0, 0, 0];

    const playBeat = () => {
      if (!isGameRunning || isPaused || isMuted) return;
      
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
    } else {
      if (musicIntervalRef.current) {
        clearInterval(musicIntervalRef.current);
        musicIntervalRef.current = null;
      }
    }
    return () => {
      if (musicIntervalRef.current) clearInterval(musicIntervalRef.current);
    };
  }, [isGameRunning, isPaused, isMuted, startBackgroundMusic]);

  // Update music gain when muted changes
  useEffect(() => {
    if (musicGainRef.current && audioContextRef.current) {
      musicGainRef.current.gain.setTargetAtTime(isMuted ? 0 : 0.03, audioContextRef.current.currentTime, 0.1);
    }
  }, [isMuted]);

  // sound player
  const playSound = useCallback((frequency: number, type: OscillatorType = 'sine', duration = 0.1, volume = 0.1, sweep = true) => {
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

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }, [isMuted]);

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
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      setTimeout(() => playSound(freq, 'sine', 0.15, 0.05, true), i * 60);
    });
  }, [playSound]);

  const playMissSound = useCallback(() => {
    // Dissonant, low-frequency buzz for misses
    playSound(90, 'sawtooth', 0.1, 0.1, false);
    setTimeout(() => playSound(60, 'sawtooth', 0.15, 0.1, false), 40);
    setIsMissed(true);
    setTimeout(() => setIsMissed(false), 150);
  }, [playSound]);

  const playComboMilestoneSound = useCallback(() => {
    const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5 (Major chord)
    notes.forEach((freq, i) => {
      setTimeout(() => playSound(freq, 'sine', 0.2, 0.1, true), i * 40);
    });
  }, [playSound]);

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
    setIsGameRunning(false);
    setIsPaused(false);
    setCircles([]);
    if (timerRef.current) clearInterval(timerRef.current);
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    if (musicIntervalRef.current) clearInterval(musicIntervalRef.current);
    musicIntervalRef.current = null;
    if (scoreRef.current > 0) playGameOverSound();
  }, [playGameOverSound]);

  // Sync high score
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem("tapHighScore", score.toString());
    }
  }, [score, highScore]);

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
    
    const newCircle: Circle = {
      id: nextCircleId.current++,
      x,
      y,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size,
      letter: randomLetter
    };

    setCircles(prev => [...prev, newCircle]);

    // Cleanup circle after current speed duration
    setTimeout(() => {
      if (!isPaused) {
        setCircles(prev => prev.filter(c => c.id !== newCircle.id));
      }
    }, speed);

    // Schedule next spawn
    spawnTimerRef.current = setTimeout(() => {
      spawnCircle();
    }, speed * 0.8); // Slight overlap for continuity
  }, [isGameRunning, isPaused, speed, dimensions, difficulty]);

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
    if (timeSinceLastTap < 1000) {
      newCombo = newCombo + 1;
    } else {
      newCombo = 1;
    }
    setCombo(newCombo);
    comboRef.current = newCombo;
    lastTapTime.current = now;

    setScore(prev => {
      const next = prev + 1;
      scoreRef.current = next;
      return next;
    });

    setLastHitColor(circle.color);
    setCircles(prev => prev.filter(c => c.id !== circle.id));
    
    // Play sound logic using current values
    const currentScore = scoreRef.current;
    const isBonus = currentScore % 5 === 0;
    if (isBonus) playBonusSound();
    
    if (newCombo > 0 && newCombo % 10 === 0) {
      playComboMilestoneSound();
    }

    const freqBoost = Math.min(newCombo * 10, 200); // Slightly reduced multiplier for clearer pitch
    const baseFreq = COLOR_FREQ_BASE[circle.color] || 440;
    
    // Add ±5% frequency jitter for character
    const jitterFactor = 0.95 + (Math.random() * 0.1);
    const finalFreq = (baseFreq + freqBoost) * jitterFactor;
    
    // Determine waveform and volume based on difficulty
    const waveform = WAVEFORMS[difficulty];
    const tapVolume = difficulty === 'HARD' ? 0.05 : 0.1; // Square waves are louder, so lower volume
    const tapDuration = difficulty === 'HARD' ? 0.08 : 0.15;

    playSound(finalFreq, waveform, tapDuration, tapVolume, true);

    // Create effect
    const word = isBonus ? FEEDBACK_WORDS[Math.floor(Math.random() * FEEDBACK_WORDS.length)] : (newCombo > 5 ? `${newCombo}x COMBO!` : "+1");
    
    const particleCount = 10 + Math.min(newCombo * 2, 20);
    const particles: Particle[] = Array.from({ length: particleCount }).map((_, i) => {
      const angle = (Math.random() * 360) * (Math.PI / 180);
      const dist = 30 + Math.random() * (40 + newCombo * 5);
      return {
        id: i,
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist,
        size: 2 + Math.random() * 4
      };
    });

    const newEffect: TapEffect = {
      id: nextEffectId.current++,
      x: circle.x,
      y: circle.y,
      text: word,
      color: circle.color,
      particles,
      isKeyboard
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
      className="min-h-screen bg-slate-950 text-white font-sans flex flex-col items-center p-4 overflow-x-hidden select-none"
      onClick={() => isGameRunning && !isPaused && playMissSound()}
    >
      <AnimatePresence>
        {showIntro && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center p-6 text-center overflow-hidden"
          >
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
                    <h1 className="text-4xl sm:text-8xl font-black italic tracking-tighter text-white drop-shadow-[0_10px_30px_rgba(56,189,248,0.4)] uppercase">
                      TAP GAME <span className="text-sky-400">PRO</span>
                    </h1>
                    <div className="mt-2 sm:mt-4 text-slate-500 font-bold uppercase tracking-[0.5em] sm:tracking-[1em] text-[8px] sm:text-[10px]">
                      Elite Reflex Training
                    </div>
                  </motion.div>

                  <motion.button 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    onClick={() => {
                      playSound(440, 'sine', 0.2, 0.05, true);
                      setIntroStep('SETUP');
                    }}
                    className="group relative px-10 sm:px-16 py-4 sm:py-5 rounded-full bg-white text-slate-950 font-black text-lg sm:text-2xl uppercase italic tracking-tighter hover:bg-sky-400 hover:text-white transition-all shadow-[0_0_60px_rgba(255,255,255,0.1)] hover:shadow-sky-500/50 hover:scale-110 active:scale-95"
                  >
                    Initialize Setup
                  </motion.button>
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
                      className="group w-full py-4 sm:py-6 rounded-2xl sm:rounded-[2rem] bg-white text-slate-950 font-black text-lg sm:text-2xl italic tracking-tighter uppercase shadow-[0_20px_50px_rgba(255,255,255,0.1)] hover:shadow-emerald-500/60 hover:bg-emerald-400 hover:text-white transition-all flex items-center justify-center gap-2 sm:gap-3"
                    >
                      Lock In & Deploy <Play size={20} className="sm:w-6 sm:h-6 group-hover:translate-x-2 transition-transform" />
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
            className="text-2xl sm:text-4xl font-black tracking-tighter flex items-center gap-2 text-sky-400 italic uppercase"
          >
            <Zap className="fill-current w-5 h-5 sm:w-8 sm:h-8" /> Tap <span className="hidden sm:inline">Game</span> PRO
          </motion.h1>
          <div className="flex items-center gap-1 sm:gap-2">
            <button 
              onClick={() => setShowHelp(!showHelp)}
              className={`p-2 rounded-full transition-all ${showHelp ? 'bg-sky-500 text-white shadow-lg' : 'hover:bg-slate-900 text-slate-400 hover:text-white'}`}
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

        <div className="w-full grid grid-cols-3 gap-1 sm:gap-2 text-center bg-slate-900/50 p-2 sm:p-4 rounded-2xl border border-slate-800 backdrop-blur-sm shadow-xl">
          <div className="flex flex-col items-center relative">
            <AnimatePresence mode="popLayout">
              {combo > 1 && (
                <motion.div
                  key={combo}
                  initial={{ scale: 0.8, opacity: 0, y: 5 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 1.2, opacity: 0, y: -15 }}
                  transition={{ duration: 0.2, type: "spring", stiffness: 400, damping: 10 }}
                  className="absolute -top-7 sm:top-8 left-1/2 -translate-x-1/2 whitespace-nowrap"
                >
                  <div className="bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded-full backdrop-blur-sm shadow-[0_0_15px_rgba(56,189,248,0.3)]">
                    <span className="text-[8px] sm:text-[10px] font-black text-sky-400 tracking-tighter uppercase italic">
                      {combo}x <span className="text-[6px] sm:text-[8px]">Combo!</span>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-slate-500 font-bold">Score</span>
            <span className="text-xl sm:text-2xl font-mono font-bold text-sky-400">{score}</span>
          </div>
          <div className="flex flex-col items-center border-x border-slate-800">
            <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1">
              <Timer size={8} className="sm:w-[10px]" /> Time
            </span>
            <span className={`text-xl sm:text-2xl font-mono font-bold ${timeLeft <= 5 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>
              {timeLeft}s
            </span>
          </div>
          <div className="flex flex-col items-center group relative min-w-[60px] sm:min-w-[80px]">
            <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1">
              <Trophy size={8} className="sm:w-[10px]" /> High
            </span>
            <div className="flex flex-col items-center">
              <span className="text-xl sm:text-2xl font-mono font-bold text-amber-400">{highScore}</span>
            </div>
          </div>
        </div>

        {!isGameRunning && (
          <div className="flex flex-col items-center gap-3 w-full">
            <div className="w-full flex flex-wrap justify-center gap-2">
              <div className="flex bg-slate-900/80 p-1 rounded-full border border-slate-800 shadow-inner">
                <button
                  onClick={() => setIsMobileMode(false)}
                  className={`px-3 sm:px-6 py-1 rounded-full text-[8px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1 sm:gap-2 ${
                    !isMobileMode
                      ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Zap size={8} className={!isMobileMode ? 'fill-current' : ''} />
                  Keys
                </button>
                <button
                  onClick={() => setIsMobileMode(true)}
                  className={`px-3 sm:px-6 py-1 rounded-full text-[8px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1 sm:gap-2 ${
                    isMobileMode
                      ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Zap size={8} className={isMobileMode ? 'fill-current' : ''} />
                  Touch
                </button>
              </div>

              <div className="flex gap-1 sm:gap-2 items-center bg-slate-900/40 p-1 rounded-full border border-slate-800/50">
                {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => setDifficulty(level)}
                    className={`px-3 sm:px-4 py-1 rounded-full text-[8px] sm:text-[10px] font-black uppercase tracking-widest transition-all ${
                      difficulty === level
                        ? `${DIFFICULTY_SETTINGS[level].color.replace('text-', 'bg-').replace('-400', '-500')} text-white shadow-lg shadow-${DIFFICULTY_SETTINGS[level].color.split('-')[1]}-500/20`
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
            className={`flex items-center gap-2 px-6 sm:px-8 py-2 sm:py-3 rounded-full font-bold text-base sm:text-lg transition-all shadow-lg active:scale-95 ${
              isGameRunning 
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50' 
                : 'bg-sky-500 hover:bg-sky-400 text-white hover:shadow-sky-500/20'
            }`}
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
          <div className="flex gap-3 mt-2 animate-in fade-in slide-in-from-top-2 duration-500">
            <button
              onClick={togglePause}
              id="pauseButton"
              className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl border font-black transition-all text-[10px] uppercase tracking-[0.2em] shadow-xl ${
                isPaused 
                  ? 'bg-emerald-500 border-transparent text-white animate-pulse' 
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {isPaused ? <Play size={14} className="fill-current" /> : <div className="flex gap-1"><div className="w-1 h-3 bg-current rounded-full"/><div className="w-1 h-3 bg-current rounded-full"/></div>}
              {isPaused ? 'Resume Game' : 'Pause Game'}
            </button>
            <button
              onClick={stopGameEarly}
              id="stopButton"
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 font-black hover:bg-rose-500 hover:text-white transition-all text-[10px] uppercase tracking-[0.2em] shadow-xl"
            >
              <div className="w-3 h-3 bg-current rounded-sm" />
              Stop Game
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
        className={`relative w-full max-w-2xl h-[55vh] md:h-[60vh] lg:h-[65vh] max-h-[800px] bg-slate-900 border-2 rounded-3xl overflow-hidden mt-1 sm:mt-2 shadow-inner transition-all duration-75 ${
          isKeyboardHit 
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
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-slate-950/80 px-3 py-1 rounded-full border border-sky-500/30 text-[10px] font-black text-sky-400 uppercase tracking-widest animate-pulse backdrop-blur-sm z-10">
              <Zap size={10} className="fill-current" /> Keyboard Control Active
            </div>
          )}

          {circles.map((circle) => (
            <motion.div
              key={circle.id}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              onClick={(e) => handleTap(circle, e)}
              className="absolute cursor-pointer rounded-full shadow-lg flex items-center justify-center"
              style={{
                left: circle.x,
                top: circle.y,
                width: circle.size,
                height: circle.size,
                backgroundColor: circle.color,
                boxShadow: `0 0 20px ${circle.color}44`
              }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <span 
                className="text-white font-black select-none drop-shadow-md pb-0.5"
                style={{ fontSize: circle.size * 0.4 }}
              >
                {!isMobileMode && circle.letter}
              </span>
            </motion.div>
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
                  boxShadow: `0 0 10px ${effect.color}`
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/40 backdrop-blur-[2px]">
            {timeLeft === 0 && (
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center p-8 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl"
              >
                <h2 className="text-4xl font-black text-rose-500 mb-2 uppercase italic tracking-tighter">Game Over</h2>
                <p className="text-slate-400 mb-6">Final Score: <span className="text-white font-bold">{score}</span></p>
                <div className="grid grid-cols-1 gap-3 min-w-[200px]">
                  <button 
                    onClick={startGame}
                    className="bg-sky-500 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest hover:bg-sky-400 transition-all shadow-lg active:scale-95"
                  >
                    Quick Retry
                  </button>
                  <button 
                    onClick={() => {
                      setShowIntro(true);
                      setIntroStep('TITLE');
                      setScore(0);
                      setCombo(0);
                    }}
                    className="bg-slate-800 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest hover:bg-slate-700 transition-all border border-slate-700 active:scale-95"
                  >
                    Main Menu
                  </button>
                  <button 
                    onClick={async () => {
                      const text = `I just scored ${score} in Tap Game Pro! Can you beat me?`;
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
                        // Fallback: Copy to clipboard
                        navigator.clipboard.writeText(text);
                        alert("Score copied to clipboard!");
                      }
                    }}
                    className="bg-white text-slate-950 px-8 py-3 rounded-2xl font-black uppercase tracking-widest hover:bg-amber-400 hover:text-white transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                  >
                    Share Result <Zap size={14} className="fill-current" />
                  </button>
                  
                  {highScore > 0 && (
                    <button 
                      onClick={resetHighScore}
                      className="text-[10px] text-slate-500 hover:text-rose-500 transition-colors uppercase font-bold tracking-widest mt-2"
                    >
                      Reset High Score
                    </button>
                  )}
                </div>
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

import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

// Cleanup after each test case
afterEach(() => {
  cleanup();
});

// Mock Firebase
beforeAll(() => {
  vi.mock('firebase/app', () => ({
    initializeApp: vi.fn(),
    getApps: vi.fn(() => []),
    getApp: vi.fn(() => ({}))
  }));

  vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({
      currentUser: null,
      signInWithEmailAndPassword: vi.fn(),
      createUserWithEmailAndPassword: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChanged: vi.fn()
    })),
    onAuthStateChanged: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    User: vi.fn()
  }));

  vi.mock('firebase/firestore', () => ({
    getFirestore: vi.fn(() => ({})),
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn()
  }));
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn()
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn()
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn()
};
Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock
});

// Mock HTMLMediaElement
Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
  writable: true,
  value: false,
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Comment out if you want to see console logs in tests
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Set up environment variables
process.env.VITE_API_BASE_URL = 'http://localhost:8080/api/v1';
process.env.VITE_FIREBASE_API_KEY = 'test-api-key';
process.env.VITE_FIREBASE_AUTH_DOMAIN = 'test-project.firebaseapp.com';
process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
process.env.VITE_GOOGLE_MAPS_API_KEY = 'test-maps-key';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google sign-in error:", error);
    throw error;
  }
};

// Test connection
export const initFirebase = async () => {
  try {
    // Test connection
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection verified.");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (errorMsg.includes('permission-denied') || errorMsg.includes('insufficient permissions')) {
      console.log("Firestore connection verified (restricted access).");
    } else if (errorMsg.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or internet connection.");
    } else {
      console.error("Firebase initialization notification:", error);
    }
  }
};

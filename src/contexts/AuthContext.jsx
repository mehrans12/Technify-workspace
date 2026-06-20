import { createContext, useContext, useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Email/Password Signup
  async function signup(email, password, displayName) {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    if (displayName) {
      await updateProfile(user, { displayName });
    }
    
    // Create user document in Firestore
    await setDoc(doc(db, 'Users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: displayName || user.email.split('@')[0],
      role: 'Developer',
      createdAt: new Date().toISOString()
    });
    
    return userCredential;
  }

  // Email/Password Login
  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  // Google OAuth Login/Signup
  async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth, provider);
    const user = userCredential.user;

    // Check if user document exists, if not, create one
    const userDocRef = doc(db, 'Users', user.uid);
    const userDoc = await getDoc(userDocRef);
    
    if (!userDoc.exists()) {
      await setDoc(userDocRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        role: 'Developer',
        createdAt: new Date().toISOString()
      });
    }
    
    return userCredential;
  }

  // Logout
  function logout() {
    return signOut(auth);
  }

  useEffect(() => {
    let unsubscribe;
    try {
      unsubscribe = onAuthStateChanged(
        auth, 
        async (user) => {
          if (user) {
            // We can fetch extended user data from Firestore here if needed later
            setCurrentUser(user);
          } else {
            setCurrentUser(null);
          }
          setLoading(false);
        },
        (error) => {
          console.error("Firebase Auth Error:", error);
          setLoading(false); // Make sure we stop loading even on error
        }
      );
    } catch (err) {
      console.error("Failed to initialize Firebase Auth listener:", err);
      setLoading(false);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const value = {
    currentUser,
    signup,
    login,
    loginWithGoogle,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

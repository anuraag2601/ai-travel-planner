import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, WriteResult, DocumentSnapshot } from 'firebase-admin/firestore';
import { getAuth, Auth, UserRecord } from 'firebase-admin/auth';
import { config } from '@/config/index.js';
import { logger } from '@/utils/logger.js';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  emailVerified: boolean;
  disabled: boolean;
  metadata: {
    creationTime: string;
    lastSignInTime?: string;
  };
  customClaims?: Record<string, any>;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  currency: string;
  language: string;
  dateFormat: string;
  timeFormat: string;
  notifications: {
    email: boolean;
    push: boolean;
    priceAlerts: boolean;
  };
  travel: {
    preferredClass: string;
    dietaryRestrictions: string[];
    accessibilityNeeds: string[];
    accommodationType: string[];
  };
}

export interface Itinerary {
  id: string;
  userId: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  duration: number;
  status: 'draft' | 'completed' | 'shared';
  data: any; // The full itinerary data from Claude
  createdAt: string;
  updatedAt: string;
  sharedWith?: string[];
  version: number;
}

export interface SearchHistory {
  id: string;
  userId: string;
  type: 'flight' | 'hotel' | 'itinerary';
  query: any;
  results?: any;
  timestamp: string;
}

export interface PriceAlert {
  id: string;
  userId: string;
  type: 'flight' | 'hotel';
  targetId: string; // Flight offer ID or hotel offer ID
  threshold: number;
  currency: string;
  active: boolean;
  createdAt: string;
  lastChecked?: string;
  notificationCount: number;
}

export class FirebaseService {
  private firestore: Firestore;
  private auth: Auth;

  constructor() {
    try {
      // Initialize Firebase Admin SDK
      const serviceAccount = config.firebase.serviceAccount as ServiceAccount;
      
      const app = initializeApp({
        credential: cert(serviceAccount),
        projectId: config.firebase.projectId,
      });

      this.firestore = getFirestore(app);
      this.auth = getAuth(app);

      logger.info('Firebase service initialized successfully', {
        projectId: config.firebase.projectId,
      });
    } catch (error: any) {
      logger.error('Failed to initialize Firebase service:', error);
      throw new Error('Firebase service initialization failed');
    }
  }

  // User Management
  async createUser(email: string, password: string, displayName?: string): Promise<User> {
    try {
      const userRecord = await this.auth.createUser({
        email,
        password,
        displayName,
        emailVerified: false,
      });

      // Create user preferences document
      const defaultPreferences: UserPreferences = {
        currency: 'USD',
        language: 'en',
        dateFormat: 'MM/DD/YYYY',
        timeFormat: '12h',
        notifications: {
          email: true,
          push: false,
          priceAlerts: true,
        },
        travel: {
          preferredClass: 'economy',
          dietaryRestrictions: [],
          accessibilityNeeds: [],
          accommodationType: ['hotel'],
        },
      };

      await this.firestore
        .collection('users')
        .doc(userRecord.uid)
        .set({
          email: userRecord.email,
          displayName: userRecord.displayName,
          preferences: defaultPreferences,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

      logger.info('User created successfully', {
        uid: userRecord.uid,
        email: userRecord.email,
      });

      return this.formatUser(userRecord, defaultPreferences);
    } catch (error: any) {
      logger.error('Failed to create user:', error);
      if (error.code === 'auth/email-already-exists') {
        throw new Error('Email already exists');
      } else if (error.code === 'auth/invalid-email') {
        throw new Error('Invalid email address');
      } else if (error.code === 'auth/weak-password') {
        throw new Error('Password is too weak');
      }
      throw new Error('Failed to create user account');
    }
  }

  async getUserById(uid: string): Promise<User | null> {
    try {
      const [userRecord, userDoc] = await Promise.all([
        this.auth.getUser(uid),
        this.firestore.collection('users').doc(uid).get(),
      ]);

      if (!userDoc.exists) {
        return null;
      }

      const userData = userDoc.data();
      return this.formatUser(userRecord, userData?.preferences);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        return null;
      }
      logger.error('Failed to get user by ID:', error);
      throw new Error('Failed to retrieve user');
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const userRecord = await this.auth.getUserByEmail(email);
      const userDoc = await this.firestore.collection('users').doc(userRecord.uid).get();

      if (!userDoc.exists) {
        return null;
      }

      const userData = userDoc.data();
      return this.formatUser(userRecord, userData?.preferences);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        return null;
      }
      logger.error('Failed to get user by email:', error);
      throw new Error('Failed to retrieve user');
    }
  }

  async updateUser(uid: string, updates: Partial<User>): Promise<void> {
    try {
      // Update Auth record if needed
      const authUpdates: any = {};
      if (updates.email) authUpdates.email = updates.email;
      if (updates.displayName) authUpdates.displayName = updates.displayName;
      if (updates.photoURL) authUpdates.photoURL = updates.photoURL;
      if (updates.emailVerified !== undefined) authUpdates.emailVerified = updates.emailVerified;
      if (updates.disabled !== undefined) authUpdates.disabled = updates.disabled;

      if (Object.keys(authUpdates).length > 0) {
        await this.auth.updateUser(uid, authUpdates);
      }

      // Update Firestore document
      const firestoreUpdates: any = {
        updatedAt: new Date().toISOString(),
      };
      if (updates.preferences) firestoreUpdates.preferences = updates.preferences;
      if (updates.displayName) firestoreUpdates.displayName = updates.displayName;

      await this.firestore.collection('users').doc(uid).update(firestoreUpdates);

      logger.info('User updated successfully', { uid });
    } catch (error: any) {
      logger.error('Failed to update user:', error);
      throw new Error('Failed to update user');
    }
  }

  async deleteUser(uid: string): Promise<void> {
    try {
      // Delete from Auth
      await this.auth.deleteUser(uid);

      // Delete from Firestore
      await this.firestore.collection('users').doc(uid).delete();

      logger.info('User deleted successfully', { uid });
    } catch (error: any) {
      logger.error('Failed to delete user:', error);
      throw new Error('Failed to delete user');
    }
  }

  async verifyIdToken(idToken: string): Promise<any> {
    try {
      const decodedToken = await this.auth.verifyIdToken(idToken);
      return decodedToken;
    } catch (error: any) {
      logger.error('Failed to verify ID token:', error);
      throw new Error('Invalid ID token');
    }
  }

  // Itinerary Management
  async saveItinerary(itinerary: Omit<Itinerary, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<string> {
    try {
      const now = new Date().toISOString();
      const itineraryData = {
        ...itinerary,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };

      const docRef = await this.firestore.collection('itineraries').add(itineraryData);

      logger.info('Itinerary saved successfully', {
        id: docRef.id,
        userId: itinerary.userId,
        destination: itinerary.destination,
      });

      return docRef.id;
    } catch (error: any) {
      logger.error('Failed to save itinerary:', error);
      throw new Error('Failed to save itinerary');
    }
  }

  async getItinerary(id: string): Promise<Itinerary | null> {
    try {
      const doc = await this.firestore.collection('itineraries').doc(id).get();

      if (!doc.exists) {
        return null;
      }

      return {
        id: doc.id,
        ...doc.data(),
      } as Itinerary;
    } catch (error: any) {
      logger.error('Failed to get itinerary:', error);
      throw new Error('Failed to retrieve itinerary');
    }
  }

  async getUserItineraries(userId: string, limit = 20, startAfter?: string): Promise<Itinerary[]> {
    try {
      let query = this.firestore
        .collection('itineraries')
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .limit(limit);

      if (startAfter) {
        const startAfterDoc = await this.firestore.collection('itineraries').doc(startAfter).get();
        query = query.startAfter(startAfterDoc);
      }

      const snapshot = await query.get();
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Itinerary[];
    } catch (error: any) {
      logger.error('Failed to get user itineraries:', error);
      throw new Error('Failed to retrieve itineraries');
    }
  }

  async updateItinerary(id: string, updates: Partial<Itinerary>): Promise<void> {
    try {
      const updateData = {
        ...updates,
        updatedAt: new Date().toISOString(),
        version: updates.version ? updates.version + 1 : 1,
      };

      await this.firestore.collection('itineraries').doc(id).update(updateData);

      logger.info('Itinerary updated successfully', { id });
    } catch (error: any) {
      logger.error('Failed to update itinerary:', error);
      throw new Error('Failed to update itinerary');
    }
  }

  async deleteItinerary(id: string): Promise<void> {
    try {
      await this.firestore.collection('itineraries').doc(id).delete();
      logger.info('Itinerary deleted successfully', { id });
    } catch (error: any) {
      logger.error('Failed to delete itinerary:', error);
      throw new Error('Failed to delete itinerary');
    }
  }

  // Search History
  async saveSearchHistory(searchHistory: Omit<SearchHistory, 'id'>): Promise<string> {
    try {
      const docRef = await this.firestore.collection('searchHistory').add(searchHistory);
      logger.info('Search history saved', { id: docRef.id, userId: searchHistory.userId });
      return docRef.id;
    } catch (error: any) {
      logger.error('Failed to save search history:', error);
      throw new Error('Failed to save search history');
    }
  }

  async getUserSearchHistory(userId: string, type?: string, limit = 50): Promise<SearchHistory[]> {
    try {
      let query = this.firestore
        .collection('searchHistory')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit);

      if (type) {
        query = query.where('type', '==', type);
      }

      const snapshot = await query.get();
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as SearchHistory[];
    } catch (error: any) {
      logger.error('Failed to get search history:', error);
      throw new Error('Failed to retrieve search history');
    }
  }

  // Price Alerts
  async createPriceAlert(alert: Omit<PriceAlert, 'id'>): Promise<string> {
    try {
      const docRef = await this.firestore.collection('priceAlerts').add(alert);
      logger.info('Price alert created', { id: docRef.id, userId: alert.userId });
      return docRef.id;
    } catch (error: any) {
      logger.error('Failed to create price alert:', error);
      throw new Error('Failed to create price alert');
    }
  }

  async getUserPriceAlerts(userId: string, active = true): Promise<PriceAlert[]> {
    try {
      let query = this.firestore
        .collection('priceAlerts')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');

      if (active !== undefined) {
        query = query.where('active', '==', active);
      }

      const snapshot = await query.get();
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as PriceAlert[];
    } catch (error: any) {
      logger.error('Failed to get price alerts:', error);
      throw new Error('Failed to retrieve price alerts');
    }
  }

  async updatePriceAlert(id: string, updates: Partial<PriceAlert>): Promise<void> {
    try {
      await this.firestore.collection('priceAlerts').doc(id).update(updates);
      logger.info('Price alert updated', { id });
    } catch (error: any) {
      logger.error('Failed to update price alert:', error);
      throw new Error('Failed to update price alert');
    }
  }

  async deletePriceAlert(id: string): Promise<void> {
    try {
      await this.firestore.collection('priceAlerts').doc(id).delete();
      logger.info('Price alert deleted', { id });
    } catch (error: any) {
      logger.error('Failed to delete price alert:', error);
      throw new Error('Failed to delete price alert');
    }
  }

  // Utility methods
  private formatUser(userRecord: UserRecord, preferences?: UserPreferences): User {
    return {
      uid: userRecord.uid,
      email: userRecord.email || '',
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      emailVerified: userRecord.emailVerified,
      disabled: userRecord.disabled,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime,
      },
      customClaims: userRecord.customClaims,
      preferences,
    };
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // Test Firestore connection
      await this.firestore.collection('health').limit(1).get();
      
      // Test Auth connection
      await this.auth.listUsers(1);

      return true;
    } catch (error) {
      logger.error('Firebase health check failed:', error);
      return false;
    }
  }

  // Batch operations
  async batchWrite(operations: Array<{
    type: 'create' | 'update' | 'delete';
    collection: string;
    docId?: string;
    data?: any;
  }>): Promise<void> {
    try {
      const batch = this.firestore.batch();

      operations.forEach(op => {
        const docRef = op.docId 
          ? this.firestore.collection(op.collection).doc(op.docId)
          : this.firestore.collection(op.collection).doc();

        switch (op.type) {
          case 'create':
            batch.create(docRef, op.data);
            break;
          case 'update':
            batch.update(docRef, op.data);
            break;
          case 'delete':
            batch.delete(docRef);
            break;
        }
      });

      await batch.commit();
      logger.info('Batch operation completed', { operationCount: operations.length });
    } catch (error: any) {
      logger.error('Batch operation failed:', error);
      throw new Error('Batch operation failed');
    }
  }
}

export default FirebaseService;
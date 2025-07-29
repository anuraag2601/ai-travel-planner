import { initializeApp, cert, getApps, ServiceAccount } from 'firebase-admin/app'
import { getFirestore, Firestore } from 'firebase-admin/firestore'
import { getAuth, Auth } from 'firebase-admin/auth'
import { getStorage, Storage } from 'firebase-admin/storage'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { config } from './index.js'
import { logger } from '@/utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let db: Firestore
let auth: Auth
let storage: Storage

export async function initializeFirebase(): Promise<void> {
  try {
    // Check if Firebase app is already initialized
    if (getApps().length > 0) {
      logger.info('Firebase already initialized')
      return
    }

    let serviceAccount: ServiceAccount

    // Load service account credentials
    if (config.firestore.credentialsPath) {
      // Load from file path
      const credentialsPath = config.firestore.credentialsPath.startsWith('/')
        ? config.firestore.credentialsPath
        : join(__dirname, '../../', config.firestore.credentialsPath)
      
      const credentialsData = readFileSync(credentialsPath, 'utf8')
      serviceAccount = JSON.parse(credentialsData) as ServiceAccount
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Load from environment variable file path
      const credentialsData = readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
      serviceAccount = JSON.parse(credentialsData) as ServiceAccount
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      // Load from environment variable JSON string
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as ServiceAccount
    } else {
      throw new Error('No Firebase service account credentials found')
    }

    // Initialize Firebase Admin
    const app = initializeApp({
      credential: cert(serviceAccount),
      projectId: config.firestore.projectId,
      storageBucket: `${config.firestore.projectId}.appspot.com`,
    })

    // Initialize services
    db = getFirestore(app)
    auth = getAuth(app)
    storage = getStorage(app)

    // Configure Firestore settings
    db.settings({
      ignoreUndefinedProperties: true,
      timestampsInSnapshots: true,
    })

    logger.info('Firebase initialized successfully', {
      projectId: config.firestore.projectId,
      databaseId: config.firestore.databaseId,
    })
  } catch (error) {
    logger.error('Failed to initialize Firebase:', error)
    throw error
  }
}

// Export Firebase services
export { db as firestore, auth as firebaseAuth, storage as firebaseStorage }

// Firebase utility functions
export class FirebaseService {
  static async createUser(userData: {
    email: string
    password: string
    firstName: string
    lastName: string
    emailVerified?: boolean
  }) {
    try {
      const userRecord = await auth.createUser({
        email: userData.email,
        password: userData.password,
        displayName: `${userData.firstName} ${userData.lastName}`,
        emailVerified: userData.emailVerified || false,
      })

      // Create user document in Firestore
      await db.collection('users').doc(userRecord.uid).set({
        profile: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
        },
        preferences: {
          currency: 'USD',
          language: 'en',
          timezone: 'America/New_York',
          dateFormat: 'MM/DD/YYYY',
          timeFormat: '12h',
          notifications: {
            email: true,
            push: false,
            sms: false,
            priceAlerts: true,
            itineraryUpdates: true,
            marketingEmails: false,
          },
          travel: {
            preferredClass: 'economy',
            seatPreference: 'any',
            mealPreference: 'standard',
            budgetRange: {
              min: 0,
              max: 5000,
              currency: 'USD',
            },
            accommodationTypes: ['hotel'],
            activityInterests: [],
            travelPace: 'moderate',
            groupSize: 'solo',
          },
          accessibility: {
            wheelchairAccess: false,
            visualImpairment: false,
            hearingImpairment: false,
            mobilityAssistance: false,
            dietaryRestrictions: [],
          },
        },
        account: {
          status: 'active',
          emailVerified: userData.emailVerified || false,
          phoneVerified: false,
          subscriptionTier: 'free',
          registrationDate: new Date(),
          lastLoginDate: null,
          loginCount: 0,
          referralCode: generateReferralCode(),
        },
        travelStats: {
          totalTrips: 0,
          totalCountriesVisited: 0,
          totalCitiesVisited: 0,
          favoriteDestinations: [],
          totalMilesFlown: 0,
          totalNightsStayed: 0,
          averageTripDuration: 0,
          preferredSeasons: [],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      })

      return userRecord
    } catch (error) {
      logger.error('Failed to create Firebase user:', error)
      throw error
    }
  }

  static async getUserByEmail(email: string) {
    try {
      return await auth.getUserByEmail(email)
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        return null
      }
      throw error
    }
  }

  static async getUserById(uid: string) {
    try {
      return await auth.getUser(uid)
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        return null
      }
      throw error
    }
  }

  static async updateUser(uid: string, updates: {
    email?: string
    displayName?: string
    emailVerified?: boolean
    disabled?: boolean
  }) {
    try {
      return await auth.updateUser(uid, updates)
    } catch (error) {
      logger.error('Failed to update Firebase user:', error)
      throw error
    }
  }

  static async deleteUser(uid: string) {
    try {
      // Delete from Firebase Auth
      await auth.deleteUser(uid)
      
      // Delete user document from Firestore
      await db.collection('users').doc(uid).delete()
      
      logger.info('User deleted successfully', { uid })
    } catch (error) {
      logger.error('Failed to delete Firebase user:', error)
      throw error
    }
  }

  static async verifyIdToken(idToken: string) {
    try {
      return await auth.verifyIdToken(idToken, true)
    } catch (error) {
      logger.error('Failed to verify ID token:', error)
      throw error
    }
  }

  static async generateCustomToken(uid: string, claims?: object) {
    try {
      return await auth.createCustomToken(uid, claims)
    } catch (error) {
      logger.error('Failed to generate custom token:', error)
      throw error
    }
  }

  static async sendEmailVerification(email: string) {
    try {
      const link = await auth.generateEmailVerificationLink(email)
      return link
    } catch (error) {
      logger.error('Failed to generate email verification link:', error)
      throw error
    }
  }

  static async sendPasswordResetEmail(email: string) {
    try {
      const link = await auth.generatePasswordResetLink(email)
      return link
    } catch (error) {
      logger.error('Failed to generate password reset link:', error)
      throw error
    }
  }

  // Firestore utility methods
  static async getUserDocument(uid: string) {
    try {
      const doc = await db.collection('users').doc(uid).get()
      return doc.exists ? { id: doc.id, ...doc.data() } : null
    } catch (error) {
      logger.error('Failed to get user document:', error)
      throw error
    }
  }

  static async updateUserDocument(uid: string, updates: any) {
    try {
      await db.collection('users').doc(uid).update({
        ...updates,
        updatedAt: new Date(),
        version: firebase.firestore.FieldValue.increment(1),
      })
    } catch (error) {
      logger.error('Failed to update user document:', error)
      throw error
    }
  }

  static async createDocument(collection: string, documentId: string, data: any) {
    try {
      await db.collection(collection).doc(documentId).set({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    } catch (error) {
      logger.error(`Failed to create document in ${collection}:`, error)
      throw error
    }
  }

  static async getDocument(collection: string, documentId: string) {
    try {
      const doc = await db.collection(collection).doc(documentId).get()
      return doc.exists ? { id: doc.id, ...doc.data() } : null
    } catch (error) {
      logger.error(`Failed to get document from ${collection}:`, error)
      throw error
    }
  }

  static async updateDocument(collection: string, documentId: string, updates: any) {
    try {
      await db.collection(collection).doc(documentId).update({
        ...updates,
        updatedAt: new Date(),
      })
    } catch (error) {
      logger.error(`Failed to update document in ${collection}:`, error)
      throw error
    }
  }

  static async deleteDocument(collection: string, documentId: string) {
    try {
      await db.collection(collection).doc(documentId).delete()
    } catch (error) {
      logger.error(`Failed to delete document from ${collection}:`, error)
      throw error
    }
  }

  static async queryDocuments(
    collection: string,
    conditions: Array<{ field: string; operator: any; value: any }>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
    limit?: number
  ) {
    try {
      let query: any = db.collection(collection)

      // Apply conditions
      conditions.forEach(condition => {
        query = query.where(condition.field, condition.operator, condition.value)
      })

      // Apply ordering
      if (orderBy) {
        query = query.orderBy(orderBy.field, orderBy.direction)
      }

      // Apply limit
      if (limit) {
        query = query.limit(limit)
      }

      const snapshot = await query.get()
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    } catch (error) {
      logger.error(`Failed to query documents from ${collection}:`, error)
      throw error
    }
  }
}

// Utility function to generate referral codes
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export default FirebaseService
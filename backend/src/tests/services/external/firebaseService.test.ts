import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { FirebaseService, User, UserPreferences, Itinerary } from '../../../services/external/firebaseService.js';

// Mock Firebase Admin SDK
const mockFirestore = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({
      set: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    })),
    add: jest.fn(),
    where: jest.fn(() => ({
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(),
          startAfter: jest.fn(() => ({
            get: jest.fn()
          }))
        })),
        where: jest.fn(() => ({
          get: jest.fn()
        }))
      }))
    })),
    orderBy: jest.fn(() => ({
      limit: jest.fn(() => ({
        get: jest.fn()
      }))
    })),
    limit: jest.fn(() => ({
      get: jest.fn()
    }))
  })),
  batch: jest.fn(() => ({
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn()
  }))
};

const mockAuth = {
  createUser: jest.fn(),
  getUser: jest.fn(),
  getUserByEmail: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  verifyIdToken: jest.fn(),
  listUsers: jest.fn()
};

// Mock the Firebase Admin imports
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({})),
  cert: jest.fn()
}));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => mockFirestore)
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => mockAuth)
}));

jest.mock('../../../config/index.js', () => ({
  config: {
    firebase: {
      serviceAccount: {
        projectId: 'test-project',
        privateKey: 'test-key',
        clientEmail: 'test@test.com'
      },
      projectId: 'test-project'
    }
  }
}));

jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('FirebaseService', () => {
  let firebaseService: FirebaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    firebaseService = new FirebaseService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('User Management', () => {
    describe('createUser', () => {
      const mockUserRecord = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: false,
        disabled: false,
        metadata: {
          creationTime: '2024-01-15T10:00:00Z',
          lastSignInTime: '2024-01-15T10:00:00Z'
        }
      };

      it('should create user successfully', async () => {
        mockAuth.createUser.mockResolvedValue(mockUserRecord);
        const mockDocRef = mockFirestore.collection().doc();
        mockDocRef.set.mockResolvedValue({});

        const result = await firebaseService.createUser('test@example.com', 'password123', 'Test User');

        expect(mockAuth.createUser).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
          displayName: 'Test User',
          emailVerified: false
        });

        expect(mockFirestore.collection).toHaveBeenCalledWith('users');
        expect(mockDocRef.set).toHaveBeenCalledWith({
          email: 'test@example.com',
          displayName: 'Test User',
          preferences: expect.objectContaining({
            currency: 'USD',
            language: 'en'
          }),
          createdAt: expect.any(String),
          updatedAt: expect.any(String)
        });

        expect(result.uid).toBe('user123');
        expect(result.email).toBe('test@example.com');
        expect(result.preferences?.currency).toBe('USD');
      });

      it('should handle email already exists error', async () => {
        const error = new Error('Email already exists');
        (error as any).code = 'auth/email-already-exists';
        mockAuth.createUser.mockRejectedValue(error);

        await expect(firebaseService.createUser('test@example.com', 'password123'))
          .rejects.toThrow('Email already exists');
      });

      it('should handle invalid email error', async () => {
        const error = new Error('Invalid email');
        (error as any).code = 'auth/invalid-email';
        mockAuth.createUser.mockRejectedValue(error);

        await expect(firebaseService.createUser('invalid-email', 'password123'))
          .rejects.toThrow('Invalid email address');
      });

      it('should handle weak password error', async () => {
        const error = new Error('Weak password');
        (error as any).code = 'auth/weak-password';
        mockAuth.createUser.mockRejectedValue(error);

        await expect(firebaseService.createUser('test@example.com', '123'))
          .rejects.toThrow('Password is too weak');
      });
    });

    describe('getUserById', () => {
      const mockUserRecord = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: true,
        disabled: false,
        metadata: {
          creationTime: '2024-01-15T10:00:00Z',
          lastSignInTime: '2024-01-15T10:00:00Z'
        }
      };

      const mockUserData = {
        preferences: {
          currency: 'EUR',
          language: 'fr'
        }
      };

      it('should get user by ID successfully', async () => {
        mockAuth.getUser.mockResolvedValue(mockUserRecord);
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.get.mockResolvedValue({
          exists: true,
          data: () => mockUserData
        });

        const result = await firebaseService.getUserById('user123');

        expect(mockAuth.getUser).toHaveBeenCalledWith('user123');
        expect(mockFirestore.collection).toHaveBeenCalledWith('users');
        expect(result?.uid).toBe('user123');
        expect(result?.preferences?.currency).toBe('EUR');
      });

      it('should return null when user document does not exist', async () => {
        mockAuth.getUser.mockResolvedValue(mockUserRecord);
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.get.mockResolvedValue({
          exists: false
        });

        const result = await firebaseService.getUserById('user123');

        expect(result).toBeNull();
      });

      it('should return null when user not found in auth', async () => {
        const error = new Error('User not found');
        (error as any).code = 'auth/user-not-found';
        mockAuth.getUser.mockRejectedValue(error);

        const result = await firebaseService.getUserById('nonexistent');

        expect(result).toBeNull();
      });

      it('should throw error for other auth errors', async () => {
        mockAuth.getUser.mockRejectedValue(new Error('Auth service error'));

        await expect(firebaseService.getUserById('user123'))
          .rejects.toThrow('Failed to retrieve user');
      });
    });

    describe('updateUser', () => {
      it('should update user successfully', async () => {
        mockAuth.updateUser.mockResolvedValue({});
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.update.mockResolvedValue({});

        const updates: Partial<User> = {
          email: 'newemail@example.com',
          displayName: 'New Name',
          preferences: {
            currency: 'EUR',
            language: 'fr',
            dateFormat: 'DD/MM/YYYY',
            timeFormat: '24h',
            notifications: {
              email: false,
              push: true,
              priceAlerts: false
            },
            travel: {
              preferredClass: 'business',
              dietaryRestrictions: ['vegetarian'],
              accessibilityNeeds: [],
              accommodationType: ['hotel', 'apartment']
            }
          }
        };

        await firebaseService.updateUser('user123', updates);

        expect(mockAuth.updateUser).toHaveBeenCalledWith('user123', {
          email: 'newemail@example.com',
          displayName: 'New Name'
        });

        expect(mockDoc.update).toHaveBeenCalledWith({
          updatedAt: expect.any(String),
          preferences: updates.preferences,
          displayName: 'New Name'
        });
      });

      it('should handle update errors', async () => {
        mockAuth.updateUser.mockRejectedValue(new Error('Update failed'));

        const updates: Partial<User> = { email: 'new@example.com' };

        await expect(firebaseService.updateUser('user123', updates))
          .rejects.toThrow('Failed to update user');
      });
    });

    describe('deleteUser', () => {
      it('should delete user successfully', async () => {
        mockAuth.deleteUser.mockResolvedValue({});
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.delete.mockResolvedValue({});

        await firebaseService.deleteUser('user123');

        expect(mockAuth.deleteUser).toHaveBeenCalledWith('user123');
        expect(mockDoc.delete).toHaveBeenCalled();
      });

      it('should handle delete errors', async () => {
        mockAuth.deleteUser.mockRejectedValue(new Error('Delete failed'));

        await expect(firebaseService.deleteUser('user123'))
          .rejects.toThrow('Failed to delete user');
      });
    });

    describe('verifyIdToken', () => {
      it('should verify ID token successfully', async () => {
        const mockDecodedToken = {
          uid: 'user123',
          email: 'test@example.com',
          aud: 'project123',
          iss: 'https://securetoken.google.com/project123'
        };

        mockAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);

        const result = await firebaseService.verifyIdToken('valid-token');

        expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('valid-token');
        expect(result).toEqual(mockDecodedToken);
      });

      it('should handle invalid token error', async () => {
        mockAuth.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

        await expect(firebaseService.verifyIdToken('invalid-token'))
          .rejects.toThrow('Invalid ID token');
      });
    });
  });

  describe('Itinerary Management', () => {
    const mockItinerary = {
      userId: 'user123',
      title: 'Paris Adventure',
      destination: 'Paris',
      startDate: '2024-03-15',
      endDate: '2024-03-21',
      duration: 7,
      status: 'completed' as const,
      data: { overview: { title: 'Paris Trip' } }
    };

    describe('saveItinerary', () => {
      it('should save itinerary successfully', async () => {
        const mockDocRef = { id: 'itinerary123' };
        mockFirestore.collection().add.mockResolvedValue(mockDocRef);

        const result = await firebaseService.saveItinerary(mockItinerary);

        expect(mockFirestore.collection).toHaveBeenCalledWith('itineraries');
        expect(mockFirestore.collection().add).toHaveBeenCalledWith({
          ...mockItinerary,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          version: 1
        });
        expect(result).toBe('itinerary123');
      });

      it('should handle save errors', async () => {
        mockFirestore.collection().add.mockRejectedValue(new Error('Save failed'));

        await expect(firebaseService.saveItinerary(mockItinerary))
          .rejects.toThrow('Failed to save itinerary');
      });
    });

    describe('getItinerary', () => {
      it('should get itinerary successfully', async () => {
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.get.mockResolvedValue({
          exists: true,
          id: 'itinerary123',
          data: () => mockItinerary
        });

        const result = await firebaseService.getItinerary('itinerary123');

        expect(mockDoc.get).toHaveBeenCalled();
        expect(result?.id).toBe('itinerary123');
        expect(result?.title).toBe('Paris Adventure');
      });

      it('should return null when itinerary does not exist', async () => {
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.get.mockResolvedValue({
          exists: false
        });

        const result = await firebaseService.getItinerary('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('getUserItineraries', () => {
      it('should get user itineraries successfully', async () => {
        const mockCollection = mockFirestore.collection();
        const mockQuery = {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'itinerary1',
                data: () => ({ ...mockItinerary, title: 'Trip 1' })
              },
              {
                id: 'itinerary2',
                data: () => ({ ...mockItinerary, title: 'Trip 2' })
              }
            ]
          })
        };

        mockCollection.where.mockReturnValue(mockQuery);

        const result = await firebaseService.getUserItineraries('user123');

        expect(mockQuery.where).toHaveBeenCalledWith('userId', '==', 'user123');
        expect(mockQuery.orderBy).toHaveBeenCalledWith('updatedAt', 'desc');
        expect(mockQuery.limit).toHaveBeenCalledWith(20);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('itinerary1');
        expect(result[0].title).toBe('Trip 1');
      });
    });

    describe('updateItinerary', () => {
      it('should update itinerary successfully', async () => {
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.update.mockResolvedValue({});

        const updates = { title: 'Updated Paris Trip', status: 'completed' as const };

        await firebaseService.updateItinerary('itinerary123', updates);

        expect(mockDoc.update).toHaveBeenCalledWith({
          ...updates,
          updatedAt: expect.any(String),
          version: 1
        });
      });
    });

    describe('deleteItinerary', () => {
      it('should delete itinerary successfully', async () => {
        const mockDoc = mockFirestore.collection().doc();
        mockDoc.delete.mockResolvedValue({});

        await firebaseService.deleteItinerary('itinerary123');

        expect(mockDoc.delete).toHaveBeenCalled();
      });
    });
  });

  describe('Search History', () => {
    const mockSearchHistory = {
      userId: 'user123',
      type: 'flight' as const,
      query: { origin: 'JFK', destination: 'CDG' },
      timestamp: '2024-01-15T10:00:00Z'
    };

    describe('saveSearchHistory', () => {
      it('should save search history successfully', async () => {
        const mockDocRef = { id: 'search123' };
        mockFirestore.collection().add.mockResolvedValue(mockDocRef);

        const result = await firebaseService.saveSearchHistory(mockSearchHistory);

        expect(mockFirestore.collection).toHaveBeenCalledWith('searchHistory');
        expect(result).toBe('search123');
      });
    });

    describe('getUserSearchHistory', () => {
      it('should get user search history successfully', async () => {
        const mockCollection = mockFirestore.collection();
        const mockQuery = {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'search1',
                data: () => mockSearchHistory
              }
            ]
          })
        };

        mockCollection.where.mockReturnValue(mockQuery);

        const result = await firebaseService.getUserSearchHistory('user123', 'flight');

        expect(mockQuery.where).toHaveBeenCalledWith('userId', '==', 'user123');
        expect(mockQuery.where).toHaveBeenCalledWith('type', '==', 'flight');
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('flight');
      });
    });
  });

  describe('Price Alerts', () => {
    const mockPriceAlert = {
      userId: 'user123',
      type: 'flight' as const,
      targetId: 'flight123',
      threshold: 1000,
      currency: 'USD',
      active: true,
      createdAt: '2024-01-15T10:00:00Z',
      notificationCount: 0
    };

    describe('createPriceAlert', () => {
      it('should create price alert successfully', async () => {
        const mockDocRef = { id: 'alert123' };
        mockFirestore.collection().add.mockResolvedValue(mockDocRef);

        const result = await firebaseService.createPriceAlert(mockPriceAlert);

        expect(mockFirestore.collection).toHaveBeenCalledWith('priceAlerts');
        expect(result).toBe('alert123');
      });
    });

    describe('getUserPriceAlerts', () => {
      it('should get user price alerts successfully', async () => {
        const mockCollection = mockFirestore.collection();
        const mockQuery = {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'alert1',
                data: () => mockPriceAlert
              }
            ]
          })
        };

        mockCollection.where.mockReturnValue(mockQuery);

        const result = await firebaseService.getUserPriceAlerts('user123');

        expect(mockQuery.where).toHaveBeenCalledWith('userId', '==', 'user123');
        expect(mockQuery.where).toHaveBeenCalledWith('active', '==', true);
        expect(result).toHaveLength(1);
        expect(result[0].targetId).toBe('flight123');
      });
    });
  });

  describe('Utility Methods', () => {
    describe('healthCheck', () => {
      it('should return true when services are healthy', async () => {
        const mockCollection = mockFirestore.collection();
        mockCollection.limit().get.mockResolvedValue({});
        mockAuth.listUsers.mockResolvedValue({});

        const result = await firebaseService.healthCheck();

        expect(result).toBe(true);
        expect(mockCollection.limit).toHaveBeenCalledWith(1);
        expect(mockAuth.listUsers).toHaveBeenCalledWith(1);
      });

      it('should return false when services are unhealthy', async () => {
        const mockCollection = mockFirestore.collection();
        mockCollection.limit().get.mockRejectedValue(new Error('Firestore down'));

        const result = await firebaseService.healthCheck();

        expect(result).toBe(false);
      });
    });

    describe('batchWrite', () => {
      it('should perform batch operations successfully', async () => {
        const mockBatch = mockFirestore.batch();
        mockBatch.commit.mockResolvedValue({});

        const operations = [
          {
            type: 'create' as const,
            collection: 'test',
            data: { name: 'Test Item' }
          },
          {
            type: 'update' as const,
            collection: 'test',
            docId: 'doc123',
            data: { updated: true }
          },
          {
            type: 'delete' as const,
            collection: 'test',
            docId: 'doc456'
          }
        ];

        await firebaseService.batchWrite(operations);

        expect(mockBatch.create).toHaveBeenCalled();
        expect(mockBatch.update).toHaveBeenCalled();
        expect(mockBatch.delete).toHaveBeenCalled();
        expect(mockBatch.commit).toHaveBeenCalled();
      });

      it('should handle batch operation errors', async () => {
        const mockBatch = mockFirestore.batch();
        mockBatch.commit.mockRejectedValue(new Error('Batch failed'));

        const operations = [
          {
            type: 'create' as const,
            collection: 'test',
            data: { name: 'Test Item' }
          }
        ];

        await expect(firebaseService.batchWrite(operations))
          .rejects.toThrow('Batch operation failed');
      });
    });
  });
});
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { resolveAirportCode, getCitySuggestions } = require('./airport-city-mapping');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// API credentials from environment
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY;
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;

// Health check endpoint
app.get('/api/v1/health', async (req, res) => {
  const health = {
    status: 'ok',
    message: 'AI Travel Planner API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/v1/health',
      'POST /api/v1/search/airports',
      'GET /api/v1/cities/suggestions',
      'POST /api/v1/search/flights',
      'POST /api/v1/search/hotels',
      'POST /api/v1/itineraries/generate'
    ],
    services: {
      anthropic: ANTHROPIC_API_KEY ? 'configured' : 'missing',
      amadeus: AMADEUS_API_KEY ? 'configured' : 'missing'
    }
  };

  // Test Amadeus API connectivity if credentials are present
  if (AMADEUS_API_KEY && AMADEUS_API_SECRET) {
    try {
      await getAmadeusToken();
      health.services.amadeus = 'active';
    } catch (error) {
      health.services.amadeus = 'authentication_failed';
      health.amadeus_error = error.message;
    }
  }

  res.json(health);
});

// Airport code resolution endpoint
app.post('/api/v1/search/airports', async (req, res) => {
  try {
    const { cities } = req.body;
    
    if (!cities || !Array.isArray(cities)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of city names in the "cities" field'
      });
    }
    
    const results = cities.map(city => ({
      input: city,
      airportCode: resolveAirportCode(city),
      suggestions: getCitySuggestions(city, 3)
    }));
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Airport resolution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve airport codes'
    });
  }
});

// City suggestions endpoint
app.get('/api/v1/cities/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least 2 characters in the "q" query parameter'
      });
    }
    
    const suggestions = getCitySuggestions(q, 10);
    
    res.json({
      success: true,
      query: q,
      suggestions
    });
  } catch (error) {
    console.error('City suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get city suggestions'
    });
  }
});

// Generate Access Token for Amadeus (Test Environment)
const AMADEUS_BASE_URL = 'https://test.api.amadeus.com';

async function getAmadeusToken() {
  try {
    const response = await axios.post(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, 
      'grant_type=client_credentials&client_id=' + AMADEUS_API_KEY + '&client_secret=' + AMADEUS_API_SECRET,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('Amadeus token error:', error.response?.data || error.message);
    throw new Error(`Amadeus authentication failed: ${error.response?.data?.error_description || error.message}`);
  }
}

// Enhanced flight search with fallbacks and recommendations
app.post('/api/v1/search/flights', async (req, res) => {
  try {
    const { origin, destination, departureDate, returnDate, adults = 1, currency = 'INR', max = 5 } = req.body;
    
    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        error: 'Missing required fields: origin, destination, departureDate'
      });
    }

    // Resolve airport codes from city names
    const originCode = resolveAirportCode(origin);
    const destinationCode = resolveAirportCode(destination);
    
    console.log(`Resolved airport codes: ${origin} -> ${originCode}, ${destination} -> ${destinationCode}`);

    const token = await getAmadeusToken();
    let flights = [];
    let searchStrategy = 'direct';
    let recommendations = [];
    
    // Strategy 1: Direct route search
    try {
      const searchParams = {
        originLocationCode: originCode,
        destinationLocationCode: destinationCode,
        departureDate: departureDate,
        adults: adults,
        max: max,
        currencyCode: currency
      };

      if (returnDate) {
        searchParams.returnDate = returnDate;
      }

      const response = await axios.get(`${AMADEUS_BASE_URL}/v2/shopping/flight-offers`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        params: searchParams
      });

      if (response.data.data && response.data.data.length > 0) {
        flights = response.data.data.map(offer => ({
          id: offer.id,
          price: {
            total: parseFloat(offer.price.total),
            currency: offer.price.currency,
            formatted: `₹${Math.round(parseFloat(offer.price.total)).toLocaleString('en-IN')}`
          },
          duration: offer.itineraries[0].duration,
          segments: offer.itineraries[0].segments.map(segment => ({
            departure: {
              airport: segment.departure.iataCode,
              time: segment.departure.at
            },
            arrival: {
              airport: segment.arrival.iataCode,
              time: segment.arrival.at
            },
            carrier: segment.carrierCode,
            flightNumber: segment.number,
            duration: segment.duration
          })),
          bookingUrl: `https://www.amadeus.com/en/booking?origin=${originCode}&destination=${destinationCode}&departure=${departureDate}${returnDate ? '&return=' + returnDate : ''}&adults=${adults}`,
          type: flights.length === 0 ? (offer.itineraries[0].segments.length === 1 ? 'direct' : 'connecting') : 'alternative'
        }));
      }
    } catch (directError) {
      console.log('Direct flight search failed:', directError.message);
    }
    
    // Strategy 2: If no results, try alternative airports
    if (flights.length === 0) {
      searchStrategy = 'alternative';
      const alternativeAirports = {
        'BLR': ['MAA', 'COK'], // Bangalore alternatives: Chennai, Kochi
        'DEL': ['BOM'], // Delhi alternative: Mumbai
        'BOM': ['DEL'], // Mumbai alternative: Delhi
        'NYC': ['JFK', 'LGA', 'EWR'] // NYC alternatives
      };
      
      const originAlts = alternativeAirports[origin] || [];
      const destAlts = alternativeAirports[destination] || [];
      
      // Try origin alternatives
      for (const altOrigin of originAlts.slice(0, 2)) {
        try {
          const altSearchParams = {
            originLocationCode: altOrigin,
            destinationLocationCode: destination,
            departureDate: departureDate,
            adults: adults,
            max: 2,
            currencyCode: currency
          };
          
          if (returnDate) altSearchParams.returnDate = returnDate;
          
          const altResponse = await axios.get(`${AMADEUS_BASE_URL}/v2/shopping/flight-offers`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: altSearchParams
          });
          
          if (altResponse.data.data && altResponse.data.data.length > 0) {
            const altFlights = altResponse.data.data.slice(0, 1).map(offer => ({
              id: offer.id + '_alt',
              price: {
                total: parseFloat(offer.price.total),
                currency: offer.price.currency,
                formatted: `₹${Math.round(parseFloat(offer.price.total)).toLocaleString('en-IN')}`
              },
              duration: offer.itineraries[0].duration,
              segments: offer.itineraries[0].segments.map(segment => ({
                departure: {
                  airport: segment.departure.iataCode,
                  time: segment.departure.at
                },
                arrival: {
                  airport: segment.arrival.iataCode,
                  time: segment.arrival.at
                },
                carrier: segment.carrierCode,
                flightNumber: segment.number
              })),
              bookingUrl: `https://www.amadeus.com/en/booking?origin=${altOrigin}&destination=${destination}&departure=${departureDate}`,
              type: 'alternative',
              alternativeNote: `Depart from ${altOrigin} instead of ${origin}`
            }));
            flights.push(...altFlights);
            recommendations.push(`Consider departing from ${altOrigin} - similar distance from your location`);
            break;
          }
        } catch (error) {
          console.log(`Alternative airport search failed for ${altOrigin}:`, error.message);
        }
      }
    }
    
    // Generate smart recommendations
    if (flights.length > 0) {
      const prices = flights.map(f => f.price.total).sort((a, b) => a - b);
      const cheapest = prices[0];
      const mostExpensive = prices[prices.length - 1];
      
      if (mostExpensive > cheapest * 1.5) {
        recommendations.push(`Save ₹${Math.round(mostExpensive - cheapest).toLocaleString('en-IN')} by choosing the most economical option`);
      }
      
      const directFlights = flights.filter(f => f.segments.length === 1);
      const connectingFlights = flights.filter(f => f.segments.length > 1);
      
      if (directFlights.length > 0 && connectingFlights.length > 0) {
        const directPrice = Math.min(...directFlights.map(f => f.price.total));
        const connectingPrice = Math.min(...connectingFlights.map(f => f.price.total));
        if (directPrice > connectingPrice * 1.2) {
          recommendations.push(`Save ₹${Math.round(directPrice - connectingPrice).toLocaleString('en-IN')} with connecting flights`);
        }
      }
    }

    if (flights.length === 0) {
      return res.json({
        success: true,
        results: [],
        total: 0,
        message: 'No flights found for the selected route and dates',
        recommendations: [
          'Try searching for nearby dates (±2 days)',
          'Consider alternative airports if available',
          'Check if this is a popular travel route',
          'Some routes may require connecting flights through major hubs'
        ],
        searchStrategy: 'no_results'
      });
    }

    res.json({
      success: true,
      results: flights,
      total: flights.length,
      searchStrategy: searchStrategy,
      recommendations: recommendations,
      priceRange: {
        min: Math.min(...flights.map(f => f.price.total)),
        max: Math.max(...flights.map(f => f.price.total)),
        currency: 'INR'
      }
    });

  } catch (error) {
    console.error('Flight search error:', error.message);
    res.status(500).json({
      error: 'Flight search failed',
      message: 'Unable to search flights at this time',
      details: 'Please try again later or contact support if the issue persists',
      recommendations: [
        'Check your internet connection',
        'Verify the airport codes are correct',
        'Try searching for a different date'
      ]
    });
  }
});

// Enhanced hotel search with pricing and offers
app.post('/api/v1/search/hotels', async (req, res) => {
  try {
    const { cityCode, checkInDate, checkOutDate, adults = 1, currency = 'INR' } = req.body;
    
    if (!cityCode || !checkInDate || !checkOutDate) {
      return res.status(400).json({
        error: 'Missing required fields: cityCode, checkInDate, checkOutDate'
      });
    }

    // Resolve city code to airport code (hotels use same city codes as airports)
    const resolvedCityCode = resolveAirportCode(cityCode);
    console.log(`Resolved hotel city code: ${cityCode} -> ${resolvedCityCode}`);

    const token = await getAmadeusToken();
    let hotels = [];
    let recommendations = [];
    
    // Step 1: Get hotel list
    try {
      const hotelListResponse = await axios.get(`${AMADEUS_BASE_URL}/v1/reference-data/locations/hotels/by-city`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        params: {
          cityCode: resolvedCityCode,
          radius: 15,
          radiusUnit: 'KM',
          amenities: 'WIFI,PARKING,RESTAURANT,POOL,SPA',
          ratings: '3,4,5'
        }
      });

      if (hotelListResponse.data.data && hotelListResponse.data.data.length > 0) {
        const hotelIds = hotelListResponse.data.data.slice(0, 8).map(hotel => hotel.hotelId);
        
        // Step 2: Get hotel offers with pricing
        try {
          const offersResponse = await axios.get(`${AMADEUS_BASE_URL}/v3/shopping/hotel-offers`, {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            params: {
              hotelIds: hotelIds.join(','),
              checkInDate: checkInDate,
              checkOutDate: checkOutDate,
              adults: adults,
              currency: currency,
              lang: 'EN'
            }
          });
          
          if (offersResponse.data.data) {
            hotels = offersResponse.data.data.slice(0, 5).map(hotelData => {
              const hotel = hotelData.hotel;
              const offers = hotelData.offers || [];
              const bestOffer = offers.length > 0 ? offers[0] : null;
              
              // Calculate nights
              const checkIn = new Date(checkInDate);
              const checkOut = new Date(checkOutDate);
              const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
              
              let priceInfo = null;
              if (bestOffer && bestOffer.price) {
                const totalPrice = parseFloat(bestOffer.price.total);
                const pricePerNight = totalPrice / nights;
                priceInfo = {
                  total: totalPrice,
                  perNight: pricePerNight,
                  currency: bestOffer.price.currency,
                  formatted: {
                    total: `₹${Math.round(totalPrice).toLocaleString('en-IN')}`,
                    perNight: `₹${Math.round(pricePerNight).toLocaleString('en-IN')}/night`
                  },
                  taxes: bestOffer.price.taxes || [],
                  nights: nights
                };
              }
              
              return {
                id: hotel.hotelId,
                name: hotel.name,
                rating: hotel.rating || 4,
                location: {
                  latitude: hotel.latitude,
                  longitude: hotel.longitude
                },
                address: hotel.address || { cityName: cityCode },
                amenities: hotel.amenities || ['WIFI', 'RESTAURANT'],
                price: priceInfo,
                description: hotel.description || {},
                contact: hotel.contact || {},
                bookingUrl: bestOffer ? 
                  `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotel.name)}&checkin=${checkInDate}&checkout=${checkOutDate}&group_adults=${adults}` :
                  `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(cityCode)}&checkin=${checkInDate}&checkout=${checkOutDate}&group_adults=${adults}`,
                hasLivePrice: !!priceInfo,
                availabilityStatus: bestOffer ? 'available' : 'check_availability'
              };
            });
          }
        } catch (offersError) {
          console.log('Hotel offers search failed, using basic hotel data:', offersError.message);
          
          // Fallback: Use basic hotel data without pricing
          hotels = hotelListResponse.data.data.slice(0, 5).map(hotel => ({
            id: hotel.hotelId,
            name: hotel.name,
            rating: hotel.rating || 4,
            location: {
              latitude: hotel.geoCode.latitude,
              longitude: hotel.geoCode.longitude
            },
            address: hotel.address,
            amenities: hotel.amenities || ['WIFI', 'RESTAURANT'],
            price: null,
            bookingUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotel.name)}&checkin=${checkInDate}&checkout=${checkOutDate}&group_adults=${adults}`,
            hasLivePrice: false,
            availabilityStatus: 'check_availability'
          }));
        }
      }
    } catch (hotelListError) {
      console.log('Hotel list search failed:', hotelListError.message);
    }
    
    // Generate smart recommendations
    if (hotels.length > 0) {
      const hotelsWithPrices = hotels.filter(h => h.price);
      
      if (hotelsWithPrices.length > 1) {
        const prices = hotelsWithPrices.map(h => h.price.perNight).sort((a, b) => a - b);
        const cheapest = prices[0];
        const mostExpensive = prices[prices.length - 1];
        
        if (mostExpensive > cheapest * 1.5) {
          recommendations.push(`Price range: ₹${Math.round(cheapest).toLocaleString('en-IN')} - ₹${Math.round(mostExpensive).toLocaleString('en-IN')} per night`);
        }
      }
      
      const highRatedHotels = hotels.filter(h => h.rating >= 4.5).length;
      if (highRatedHotels > 0) {
        recommendations.push(`${highRatedHotels} hotel${highRatedHotels > 1 ? 's' : ''} with 4.5+ star rating available`);
      }
      
      const amenityCounts = {};
      hotels.forEach(hotel => {
        hotel.amenities.forEach(amenity => {
          amenityCounts[amenity] = (amenityCounts[amenity] || 0) + 1;
        });
      });
      
      const commonAmenities = Object.entries(amenityCounts)
        .filter(([_, count]) => count >= hotels.length * 0.6)
        .map(([amenity, _]) => amenity);
        
      if (commonAmenities.length > 0) {
        recommendations.push(`Most hotels include: ${commonAmenities.slice(0, 3).join(', ')}`);
      }
    }

    if (hotels.length === 0) {
      return res.json({
        success: true,
        results: [],
        total: 0,
        message: 'No hotels found for the selected destination and dates',
        recommendations: [
          'Try searching for a nearby city',
          'Check if the dates are available',
          'Consider extending your search radius',
          'Popular destinations may have limited availability during peak seasons'
        ]
      });
    }

    const hotelsWithPrices = hotels.filter(h => h.price);
    const priceRange = hotelsWithPrices.length > 0 ? {
      min: Math.min(...hotelsWithPrices.map(h => h.price.perNight)),
      max: Math.max(...hotelsWithPrices.map(h => h.price.perNight)),
      currency: 'INR'
    } : null;

    res.json({
      success: true,
      results: hotels,
      total: hotels.length,
      recommendations: recommendations,
      priceRange: priceRange,
      searchInfo: {
        checkInDate,
        checkOutDate,
        nights: Math.ceil((new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24)),
        adults,
        cityCode
      }
    });

  } catch (error) {
    console.error('Hotel search error:', error.message);
    res.status(500).json({
      error: 'Hotel search failed',
      message: 'Unable to search hotels at this time',
      details: 'Please try again later or contact support if the issue persists',
      recommendations: [
        'Check your internet connection',
        'Verify the destination city is correct',
        'Try searching for a different date range'
      ]
    });
  }
});

// AI Itinerary generation endpoint
app.post('/api/v1/itineraries/generate', async (req, res) => {
  try {
    const { 
      originCity, destination, duration, budget, interests, travelStyle, groupSize = 1,
      departureDate, returnDate, flightData, hotelData 
    } = req.body;
    
    if (!destination || !duration) {
      return res.status(400).json({
        error: 'Missing required fields: destination, duration'
      });
    }

    // Build flight information for AI context
    let flightInfo = '';
    if (flightData && flightData.success && flightData.results.length > 0) {
      const bestFlight = flightData.results[0];
      flightInfo = `\n\nLIVE FLIGHT DATA AVAILABLE:
- Best flight option: ${bestFlight.price.total} ${bestFlight.price.currency}
- Flight duration: ${bestFlight.duration}
- Departure: ${bestFlight.segments[0].departure.airport} at ${bestFlight.segments[0].departure.time}
- Arrival: ${bestFlight.segments[0].arrival.airport} at ${bestFlight.segments[0].arrival.time}
- Airline: ${bestFlight.segments[0].carrier} ${bestFlight.segments[0].flightNumber}
Please reference this flight information in your recommendations.`;
    }

    // Build hotel information for AI context
    let hotelInfo = '';
    if (hotelData && hotelData.success && hotelData.results.length > 0) {
      const bestHotel = hotelData.results[0];
      hotelInfo = `\n\nLIVE HOTEL DATA AVAILABLE:
- Recommended hotel: ${bestHotel.name}
- Rating: ${bestHotel.rating} stars
- Location: ${bestHotel.address ? Object.values(bestHotel.address).join(', ') : 'City center'}
- Amenities: ${bestHotel.amenities ? bestHotel.amenities.join(', ') : 'Standard amenities'}
Please reference this hotel information in your recommendations.`;
    }

    // Note if live data was requested but unavailable
    let dataAvailabilityNote = '';
    if (!flightInfo && !hotelInfo) {
      dataAvailabilityNote = '\n\nNOTE: Live flight and hotel data was requested but is currently unavailable due to API limitations. This itinerary provides general recommendations for flights and accommodations.';
    }

    const prompt = `Create a detailed ${duration}-day travel itinerary for ${destination}${originCity ? ` (traveling from ${originCity})` : ''}.
    
Trip Details:
- Origin: ${originCity || 'Not specified'}
- Destination: ${destination}
- Duration: ${duration} days
- Travel Dates: ${departureDate || 'Not specified'}${returnDate ? ` to ${returnDate}` : ''}
- Budget: ${budget || 'moderate'}
- Interests: ${interests || 'general sightseeing'}
- Travel Style: ${travelStyle || 'balanced'}
- Group Size: ${groupSize} people${flightInfo}${hotelInfo}${dataAvailabilityNote}

Please provide:
1. Daily schedule with specific activities and timings
2. Recommended restaurants and local cuisine
3. Transportation suggestions (including airport transfers${flightInfo ? ' based on the provided flight data' : ''})
4. Budget breakdown if budget is specified
5. Cultural insights and local tips
6. Must-see attractions and hidden gems
7. ${flightInfo || hotelInfo ? 'Integrate the provided live flight/hotel data naturally into recommendations' : 'Provide general flight and hotel recommendations with estimated costs'}

Format the response as a structured itinerary with clear day-by-day breakdown.${flightInfo || hotelInfo ? ' Reference the specific flight/hotel information provided above.' : ' Include estimated flight costs and hotel recommendations for the specified budget range.'}`;

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      }
    });

    const itinerary = {
      id: 'itin_' + Date.now(),
      destination: destination,
      duration: duration,
      budget: budget,
      generated_at: new Date().toISOString(),
      content: response.data.content[0].text,
      summary: {
        total_days: duration,
        estimated_budget: budget,
        group_size: groupSize,
        travel_style: travelStyle
      }
    };

    res.json({
      success: true,
      itinerary: itinerary
    });

  } catch (error) {
    console.error('Itinerary generation error:', error.message);
    res.status(500).json({
      error: 'Itinerary generation failed',
      message: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// Catch-all for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Travel Planner API running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`🤖 Anthropic API: ${ANTHROPIC_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`✈️  Amadeus API: ${AMADEUS_API_KEY ? 'Configured' : 'Missing'}`);
});
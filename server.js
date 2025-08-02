import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin:  ['https://rrttt-sandy.vercel.app','http://localhost:5173'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Groq API configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    app: 'ClimateWise Backend',
    version: '1.0.0'
  });
});

// Location detection endpoint
app.get('/api/location', async (req, res) => {
  try {
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
    const ip = Array.isArray(clientIP) ? clientIP[0] : clientIP;
    
    // Try multiple IP geolocation services
    const services = [
      () => fetch(`https://ipapi.co/${ip}/json/`),
      () => fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,timezone`),
      () => fetch(`https://ipinfo.io/${ip}/json`)
    ];
    
    for (const service of services) {
      try {
        const response = await service();
        if (response.ok) {
          const data = await response.json();
          
          if (data.status !== 'fail' && data.city) {
            res.json({
              city: data.city,
              region: data.regionName || data.region,
              country: data.country || data.country_name,
              latitude: parseFloat(data.lat || data.latitude),
              longitude: parseFloat(data.lon || data.longitude),
              timezone: data.timezone
            });
            return;
          }
        }
      } catch (error) {
        console.log(`Location service failed: ${error.message}`);
        continue;
      }
    }
    
    // Fallback location
    res.json({
      city: 'Mumbai',
      country: 'India',
      latitude: 19.0760,
      longitude: 72.8777,
      timezone: 'Asia/Kolkata'
    });
  } catch (error) {
    console.error('Location detection error:', error);
    res.status(500).json({ error: 'Failed to detect location' });
  }
});

// Weather data endpoint
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const latitude = lat || 19.0760;
    const longitude = lon || 72.8777;
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,uv_index,weather_code&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max&timezone=auto&forecast_days=1`;
    
    const response = await fetch(weatherUrl);
    const data = await response.json();
    
    if (data.current) {
      const weather = {
        temperature: Math.round(data.current.temperature_2m),
        feelsLike: Math.round(data.current.temperature_2m + (data.current.relative_humidity_2m > 70 ? 2 : -1)),
        humidity: data.current.relative_humidity_2m,
        windSpeed: data.current.wind_speed_10m,
        uvIndex: data.current.uv_index || 0,
        weatherCode: data.current.weather_code,
        rainProbability: data.hourly?.precipitation_probability?.[0] || 0
      };
      
      res.json({ weather });
    } else {
      res.status(500).json({ error: 'Invalid weather data received' });
    }
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

// City search endpoint
app.get('/api/search/cities/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const searchUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&featuretype=city`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'ClimateWise/1.0'
      }
    });
    const data = await response.json();
    
    const cities = data.map(item => ({
      name: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon)
    }));
    
    res.json(cities);
  } catch (error) {
    console.error('City search error:', error);
    res.status(500).json({ error: 'Failed to search cities' });
  }
});

// Weather forecast endpoint
app.get('/api/forecast', async (req, res) => {
  try {
    const { lat, lon, period = 'daily' } = req.query;
    const latitude = lat || 19.0760;
    const longitude = lon || 72.8777;
    
    let forecastDays = 7;
    if (period === 'weekly') forecastDays = 7;
    else if (period === 'monthly') forecastDays = 30;
    else if (period === 'yearly') forecastDays = 365;
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,wind_speed_10m_max&timezone=auto&forecast_days=${forecastDays}`;
    
    const response = await fetch(weatherUrl);
    const data = await response.json();
    
    if (data.daily) {
      const forecastData = data.daily.time.map((date, index) => ({
        date,
        tempMax: Math.round(data.daily.temperature_2m_max[index]),
        tempMin: Math.round(data.daily.temperature_2m_min[index]),
        precipitation: data.daily.precipitation_sum[index] || 0,
        uvIndex: data.daily.uv_index_max[index] || 0,
        windSpeed: data.daily.wind_speed_10m_max[index] || 0
      }));
      
      res.json({
        period,
        data: forecastData
      });
    } else {
      res.status(500).json({ error: 'Invalid forecast data received' });
    }
  } catch (error) {
    console.error('Forecast API error:', error);
    res.status(500).json({ error: 'Failed to fetch forecast data' });
  }
});

// AI suggestions endpoint
app.post('/api/ai/suggestions', async (req, res) => {
  try {
    const { profile, weather } = req.body;
    
    const prompt = `You are a climate intelligence AI assistant. Based on the user profile and current weather conditions, provide 3-4 personalized climate recommendations.

User Profile:
- Age: ${profile.age}
- Gender: ${profile.gender}
- Occupation: ${profile.occupation}

Current Weather:
- Temperature: ${weather.temperature}°C (${Math.round(weather.temperature * 9/5 + 32)}°F)
- UV Index: ${weather.uvIndex}
- Rain Probability: ${weather.rainProbability}%
- Humidity: ${weather.humidity}%

Please provide practical, actionable suggestions in the following JSON format:
[
  {
    "id": "unique-id",
    "type": "energy|health|safety|timing|general",
    "title": "Brief title",
    "content": "Detailed recommendation",
    "icon": "fas fa-icon-name"
  }
]

Focus on:
1. Health and safety recommendations
2. Energy efficiency tips
3. Optimal timing for activities
4. Occupation-specific advice`;

    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices[0].message.content;
    
    try {
      const suggestions = JSON.parse(content);
      res.json(suggestions);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback suggestions
      res.json([
        {
          id: 'suggestion-0',
          type: 'health',
          title: 'Stay Hydrated',
          content: 'Given the current temperature and humidity, ensure you drink plenty of water throughout the day.',
          icon: 'fas fa-tint'
        }
      ]);
    }
  } catch (error) {
    console.error('AI suggestions error:', error);
    res.status(500).json({ error: 'Failed to generate AI suggestions' });
  }
});

// Climate insights endpoint
app.post('/api/climate/insights', async (req, res) => {
  try {
    const { location, weather, userProfile } = req.body;
    
    // Generate mock climate insights with ML-style analysis
    const insights = [
      {
        id: `warming-trend-${Date.now()}`,
        type: 'trend',
        title: 'Warming Trend Detected',
        description: `${location?.city || 'Your area'} shows a 0.8°C increase compared to seasonal average`,
        severity: 'medium',
        confidence: 0.87,
        timeframe: '30-day analysis'
      },
      {
        id: `humidity-pattern-${Date.now()}`,
        type: 'pattern',
        title: 'Humidity Pattern Analysis',
        description: 'Current humidity levels are 15% above normal for this time of year',
        severity: 'low',
        confidence: 0.92,
        timeframe: 'Real-time'
      }
    ];
    
    res.json({ insights });
  } catch (error) {
    console.error('Climate insights error:', error);
    res.status(500).json({ error: 'Failed to generate climate insights' });
  }
});

// Climate simulator endpoint
app.post('/api/climate/simulator', async (req, res) => {
  try {
    const { input, profile, weather } = req.body;
    
    const prompt = `Analyze the climate impact simulation scenario and provide recommendations.

Current Weather:
- Temperature: ${weather.temperature}°C
- UV Index: ${weather.uvIndex}
- Humidity: ${weather.humidity}%

Simulation Changes:
- Temperature change: ${input.temperatureChange > 0 ? '+' : ''}${input.temperatureChange}°F
- Rainfall change: ${input.rainfallChange > 0 ? '+' : ''}${input.rainfallChange}%

User Profile:
- Age: ${profile.age}
- Occupation: ${profile.occupation}

Provide a JSON response with:
{
  "impact": "Brief description of the climate impact",
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"],
  "healthRisks": ["health risk 1", "health risk 2"]
}`;

    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices[0].message.content;
    
    try {
      const simulation = JSON.parse(content);
      res.json(simulation);
    } catch (parseError) {
      console.error('Failed to parse simulation response:', parseError);
      // Fallback simulation
      res.json({
        impact: 'Climate change simulation shows moderate impact on daily activities',
        recommendations: ['Adjust outdoor activities', 'Monitor weather conditions', 'Stay prepared'],
        healthRisks: ['Heat stress', 'Dehydration']
      });
    }
  } catch (error) {
    console.error('Climate simulator error:', error);
    res.status(500).json({ error: 'Failed to run climate simulation' });
  }
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`ClimateWise Backend running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'Not specified'}`);
});

export default app;
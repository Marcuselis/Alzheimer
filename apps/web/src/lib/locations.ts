export const COUNTRY_COORDINATES: Record<string, [number, number]> = {
    // North America
    'United States': [37.0902, -95.7129],
    'USA': [37.0902, -95.7129],
    'Canada': [56.1304, -106.3468],
    'Mexico': [23.6345, -102.5528],

    // Europe
    'United Kingdom': [55.3781, -3.4360],
    'Sweden': [60.1282, 18.6435],
    'Norway': [60.4720, 8.4689],
    'Denmark': [56.2639, 9.5018],
    'Finland': [61.9241, 25.7482],
    'Iceland': [64.9631, -19.0208],
    'Netherlands': [52.1326, 5.2913],
    'France': [46.2276, 2.2137],
    'Spain': [40.4637, -3.7492],
    'Germany': [51.1657, 10.4515],
    'Italy': [41.8719, 12.5674],
    'Switzerland': [46.8182, 8.2275],
    'Austria': [47.5162, 14.5501],
    'Poland': [51.9194, 19.1451],
    'Belgium': [50.5039, 4.4699],
    'Portugal': [39.3999, -8.2245],
    'Ireland': [53.1424, -7.6921],
    'Greece': [39.0742, 21.8243],
    'Romania': [45.9432, 24.9668],
    'Slovakia': [48.6690, 19.6990],
    'Bulgaria': [42.7339, 25.4858],
    'Serbia': [44.0165, 21.0059],
    'Czechia': [49.8175, 15.4730],
    'Hungary': [47.1625, 19.5033],
    'Ukraine': [48.3794, 31.1656],
    'Russia': [61.5240, 105.3188],
    'Turkey': [38.9637, 35.2433],

    // Asia
    'China': [35.8617, 104.1954],
    'Japan': [36.2048, 138.2529],
    'South Korea': [35.9078, 127.7669],
    'Taiwan': [23.6978, 120.9605],
    'India': [20.5937, 78.9629],
    'Singapore': [1.3521, 103.8198],
    'Israel': [31.0461, 34.8516],

    // Oceania
    'Australia': [-25.2744, 133.7751],
    'New Zealand': [-40.9006, 174.8860],

    // South America
    'Brazil': [-14.2350, -51.9253],
    'Argentina': [-38.4161, -63.6167],
    'Chile': [-35.6751, -71.5430],
    'Colombia': [4.5709, -74.2973],

    // Africa
    'South Africa': [-30.5595, 22.9375],
    'Egypt': [26.8206, 30.8025]
};

// Fallback logic in utils
export function getCoordinates(locationStr: string): [number, number] | null {
    const parts = locationStr.split(',').map(p => p.trim());
    if (parts.length === 0) return null;

    const country = parts[parts.length - 1];

    // Clean up country name if needed (e.g. "Turkey (Türkiye)" -> "Turkey")
    let cleanCountry = country;
    if (country.includes('Turkey')) cleanCountry = 'Turkey';
    if (country === 'Korea, Republic of') cleanCountry = 'South Korea';

    const coords = COUNTRY_COORDINATES[cleanCountry] || COUNTRY_COORDINATES[country];

    if (coords) return coords;

    // Check if any known country is a substring (e.g. "United States of America")
    for (const [key, val] of Object.entries(COUNTRY_COORDINATES)) {
        if (country.includes(key)) return val;
    }

    return null;
}

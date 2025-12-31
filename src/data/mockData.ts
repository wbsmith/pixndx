import type { ImageMetadata } from '@/types/gallery';

// Generate a simple deterministic embedding for demo purposes
const generateMockEmbedding = (seed: number, dims: number = 128): number[] => {
  const embedding: number[] = [];
  for (let i = 0; i < dims; i++) {
    embedding.push(Math.sin(seed * (i + 1) * 0.1) * 0.5);
  }
  return embedding;
};

// Base URL for images - update this to your CloudFront/S3 URL
const IMAGE_BASE_URL = 'https://images.unsplash.com';

// Mock data matching your JSON structure
export const mockImages: ImageMetadata[] = [
  {
    id: 'img_001',
    filename: 'DSC_4808.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1507525428034-b723cf961d3e?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1507525428034-b723cf961d3e?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1507525428034-b723cf961d3e?w=1920`,
    },
    description: "A breathtaking panoramic view captures a vibrant sunset over a coastal landscape. The sun, a brilliant orange orb, is partially obscured by dark, dramatic clouds, creating strong rays of light that streak across the sky and reflect on the calm ocean waters. A coastline dotted with small towns and infrastructure is visible, including structures that look like docks or piers. Silhouetted against the fiery sky and the glowing water are rolling hills and distant mountains.",
    tags: {
      landscape: ['coastal', 'sunset', 'mountains', 'hills'],
      weather: ['clouds', 'sunrays', 'atmospheric', 'dramatic'],
      cityscape: ['towns', 'infrastructure', 'docks', 'piers'],
    },
    mood: 'Serene, dramatic, peaceful, awe-inspiring',
    main_subject: 'Sunset over a coastal town',
    main_colors: {
      orange: '#FFA500',
      dark_blue: '#000080',
      gold: '#FFD700',
    },
    exif: {
      FileName: 'DSC_4808.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 100,
      FNumber: 8,
      ExposureTime: '1/250',
      FocalLength: '35mm',
      DateTimeOriginal: '2018:04:16 21:54:19',
      ImageWidth: 4000,
      ImageHeight: 2667,
    },
    embedding: {
      clip: generateMockEmbedding(1),
      description: generateMockEmbedding(101),
    },
  },
  {
    id: 'img_002',
    filename: 'DSC_5021.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1464822759023-fed622ff2c3b?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1464822759023-fed622ff2c3b?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1464822759023-fed622ff2c3b?w=1920`,
    },
    description: "Jagged mountain peaks pierce through layers of morning mist, creating an ethereal landscape bathed in soft blue-gray tones. The rugged terrain shows dramatic elevation changes, with rocky outcrops emerging from the fog like islands in a sea of clouds. Early morning light casts long shadows across the valleys below.",
    tags: {
      landscape: ['mountain', 'peaks', 'alpine', 'wilderness'],
      weather: ['mist', 'fog', 'dawn', 'atmospheric'],
      nature: ['rocks', 'terrain', 'elevation'],
    },
    mood: 'Mysterious, majestic, peaceful, contemplative',
    main_subject: 'Misty mountain peaks at dawn',
    main_colors: {
      slate_blue: '#5D6D7E',
      mist_gray: '#85929E',
      charcoal: '#2C3E50',
    },
    exif: {
      FileName: 'DSC_5021.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 200,
      FNumber: 11,
      ExposureTime: '1/125',
      FocalLength: '70mm',
      DateTimeOriginal: '2019:07:22 06:15:33',
      ImageWidth: 3840,
      ImageHeight: 2560,
    },
    embedding: {
      clip: generateMockEmbedding(2),
      description: generateMockEmbedding(102),
    },
  },
  {
    id: 'img_003',
    filename: 'DSC_3892.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1519501025264-65ba15a82390?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1519501025264-65ba15a82390?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1519501025264-65ba15a82390?w=1920`,
    },
    description: "A dazzling metropolitan skyline glitters against the night sky. Towering skyscrapers adorned with countless illuminated windows create a stunning display of urban energy. Neon signs and streetlights add splashes of color, while the smooth surface of a nearby river reflects the city lights, doubling the visual spectacle.",
    tags: {
      cityscape: ['skyline', 'skyscrapers', 'urban', 'downtown'],
      lighting: ['neon', 'lights', 'illumination', 'glow'],
      time: ['night', 'evening', 'after-dark'],
    },
    mood: 'Energetic, vibrant, modern, exciting',
    main_subject: 'City skyline at night',
    main_colors: {
      midnight_blue: '#1A1A2E',
      electric_red: '#E74C3C',
      neon_blue: '#3498DB',
      gold: '#F1C40F',
    },
    exif: {
      FileName: 'DSC_3892.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 800,
      FNumber: 5.6,
      ExposureTime: '1/60',
      FocalLength: '24mm',
      DateTimeOriginal: '2020:11:15 22:30:45',
      ImageWidth: 5000,
      ImageHeight: 2800,
    },
    embedding: {
      clip: generateMockEmbedding(3),
      description: generateMockEmbedding(103),
    },
  },
  {
    id: 'img_004',
    filename: 'DSC_6234.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1441974231531-c6227db76b6e?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1441974231531-c6227db76b6e?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1441974231531-c6227db76b6e?w=1920`,
    },
    description: "Golden sunbeams filter through the dense canopy of ancient trees, illuminating a winding dirt path that disappears into the depths of the forest. Ferns and moss carpet the forest floor in vibrant greens, while dappled light creates a magical, almost fairytale-like atmosphere throughout the scene.",
    tags: {
      nature: ['forest', 'trees', 'path', 'woodland'],
      lighting: ['sunbeams', 'dappled', 'golden-hour'],
      flora: ['ferns', 'moss', 'canopy', 'undergrowth'],
    },
    mood: 'Enchanting, peaceful, mystical, serene',
    main_subject: 'Sunlit forest path',
    main_colors: {
      forest_green: '#27AE60',
      dark_green: '#1E8449',
      golden_light: '#F7DC6F',
      brown: '#6E2C00',
    },
    exif: {
      FileName: 'DSC_6234.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 400,
      FNumber: 4,
      ExposureTime: '1/100',
      FocalLength: '50mm',
      DateTimeOriginal: '2021:05:08 10:22:15',
      ImageWidth: 3600,
      ImageHeight: 2400,
    },
    embedding: {
      clip: generateMockEmbedding(4),
      description: generateMockEmbedding(104),
    },
  },
  {
    id: 'img_005',
    filename: 'DSC_7891.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1509316785289-025f5b846b35?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1509316785289-025f5b846b35?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1509316785289-025f5b846b35?w=1920`,
    },
    description: "Elegant curves of sand dunes stretch endlessly to the horizon under a vast, cloudless sky. The interplay of light and shadow creates mesmerizing ripple patterns across the golden landscape. The pure minimalism of the scene emphasizes the timeless, almost otherworldly quality of the desert environment.",
    tags: {
      landscape: ['desert', 'dunes', 'sand', 'horizon'],
      patterns: ['ripples', 'curves', 'shadows', 'lines'],
      abstract: ['minimalism', 'emptiness', 'vastness'],
    },
    mood: 'Vast, minimalist, timeless, contemplative',
    main_subject: 'Rolling sand dunes',
    main_colors: {
      sand_gold: '#D4AC6E',
      warm_beige: '#C19A4B',
      sky_blue: '#87CEEB',
    },
    exif: {
      FileName: 'DSC_7891.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 100,
      FNumber: 11,
      ExposureTime: '1/500',
      FocalLength: '85mm',
      DateTimeOriginal: '2022:03:12 16:45:30',
      ImageWidth: 4200,
      ImageHeight: 2800,
    },
    embedding: {
      clip: generateMockEmbedding(5),
      description: generateMockEmbedding(105),
    },
  },
  {
    id: 'img_006',
    filename: 'DSC_2156.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1551085254-e96b210db58a?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1551085254-e96b210db58a?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1551085254-e96b210db58a?w=1920`,
    },
    description: "Graceful herons stand motionless in the shallow waters of a tranquil lagoon, their elegant silhouettes reflected perfectly in the mirror-like surface. The birds appear frozen in concentration as they scan for fish beneath the still water. Soft morning light bathes the scene in gentle blue and green tones.",
    tags: {
      wildlife: ['herons', 'birds', 'wading', 'hunting'],
      water: ['lagoon', 'reflection', 'still-water', 'shallow'],
      nature: ['tranquil', 'morning', 'wetland'],
    },
    mood: 'Calm, natural, patient, graceful',
    main_subject: 'Herons wading in calm waters',
    main_colors: {
      sky_blue: '#5DADE2',
      deep_teal: '#2E86AB',
      soft_green: '#A3D9A5',
      white: '#FFFFFF',
    },
    exif: {
      FileName: 'DSC_2156.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 320,
      FNumber: 5.6,
      ExposureTime: '1/640',
      FocalLength: '300mm',
      DateTimeOriginal: '2021:09:05 07:30:22',
      ImageWidth: 3800,
      ImageHeight: 2533,
    },
    embedding: {
      clip: generateMockEmbedding(6),
      description: generateMockEmbedding(106),
    },
  },
  {
    id: 'img_007',
    filename: 'DSC_9034.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1507003211169-0a1dd7228f2d?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1507003211169-0a1dd7228f2d?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1507003211169-0a1dd7228f2d?w=1920`,
    },
    description: "A stunning tapestry of crimson, amber, and gold leaves creates a breathtaking autumn display. Individual maple leaves catch the soft afternoon light, revealing intricate vein patterns and subtle color gradations. The warm palette evokes feelings of nostalgia and the gentle transition between seasons.",
    tags: {
      nature: ['autumn', 'leaves', 'foliage', 'trees'],
      colors: ['crimson', 'amber', 'gold', 'warm'],
      season: ['fall', 'october', 'harvest'],
    },
    mood: 'Warm, nostalgic, cozy, beautiful',
    main_subject: 'Vibrant autumn foliage',
    main_colors: {
      crimson: '#E74C3C',
      amber: '#F39C12',
      burnt_orange: '#D35400',
      deep_green: '#27AE60',
    },
    exif: {
      FileName: 'DSC_9034.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 200,
      FNumber: 2.8,
      ExposureTime: '1/320',
      FocalLength: '85mm',
      DateTimeOriginal: '2020:10:18 15:45:10',
      ImageWidth: 3500,
      ImageHeight: 2333,
    },
    embedding: {
      clip: generateMockEmbedding(7),
      description: generateMockEmbedding(107),
    },
  },
  {
    id: 'img_008',
    filename: 'DSC_1567.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1482192505345-5655af888cc4?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1482192505345-5655af888cc4?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1482192505345-5655af888cc4?w=1920`,
    },
    description: "A warm golden glow emanates from the frost-covered windows of a rustic wooden cabin nestled among snow-laden evergreen trees. Fresh powder blankets the landscape in pristine white, creating a picture-perfect winter scene. Smoke rises gently from the chimney, suggesting warmth and shelter within.",
    tags: {
      architecture: ['cabin', 'rustic', 'wooden', 'chimney'],
      winter: ['snow', 'frost', 'evergreens', 'cold'],
      atmosphere: ['cozy', 'warm-glow', 'shelter'],
    },
    mood: 'Cozy, peaceful, magical, inviting',
    main_subject: 'Cozy cabin in winter wonderland',
    main_colors: {
      snow_white: '#ECF0F1',
      warm_amber: '#F39C12',
      pine_green: '#1A5276',
      wood_brown: '#8E6339',
    },
    exif: {
      FileName: 'DSC_1567.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 400,
      FNumber: 5.6,
      ExposureTime: '1/125',
      FocalLength: '35mm',
      DateTimeOriginal: '2019:12:24 16:30:00',
      ImageWidth: 4000,
      ImageHeight: 2667,
    },
    embedding: {
      clip: generateMockEmbedding(8),
      description: generateMockEmbedding(108),
    },
  },
  {
    id: 'img_009',
    filename: 'DSC_4421.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1505118380757-91f5f5632de0?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1505118380757-91f5f5632de0?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1505118380757-91f5f5632de0?w=1920`,
    },
    description: "Towering waves curl and crash with tremendous power, sending spray high into the air. The deep blue-green water reveals its raw energy as it forms massive barrels before breaking on the shore. White foam traces patterns across the surface, showcasing the ocean's untamed and dynamic nature.",
    tags: {
      water: ['ocean', 'waves', 'surf', 'sea'],
      action: ['crashing', 'spray', 'power', 'motion'],
      nature: ['raw', 'untamed', 'dynamic'],
    },
    mood: 'Powerful, dynamic, awe-inspiring, dramatic',
    main_subject: 'Powerful ocean waves crashing',
    main_colors: {
      ocean_teal: '#1ABC9C',
      deep_sea: '#16A085',
      wave_blue: '#3498DB',
      foam_white: '#ECF0F1',
    },
    exif: {
      FileName: 'DSC_4421.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 250,
      FNumber: 8,
      ExposureTime: '1/1000',
      FocalLength: '200mm',
      DateTimeOriginal: '2022:08:05 11:22:45',
      ImageWidth: 4500,
      ImageHeight: 3000,
    },
    embedding: {
      clip: generateMockEmbedding(9),
      description: generateMockEmbedding(109),
    },
  },
  {
    id: 'img_010',
    filename: 'DSC_8765.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1490750967868-88aa4486c946?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1490750967868-88aa4486c946?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1490750967868-88aa4486c946?w=1920`,
    },
    description: "An extreme close-up reveals the intricate details of delicate flower petals, showcasing nature's perfect geometry. Soft pink gradients blend seamlessly across the silky surface, while tiny dewdrops cling to the edges. The shallow depth of field creates a dreamy, ethereal quality.",
    tags: {
      nature: ['flower', 'petals', 'botanical', 'garden'],
      photography: ['macro', 'close-up', 'detail', 'bokeh'],
      colors: ['pink', 'soft', 'gradient'],
    },
    mood: 'Delicate, intimate, beautiful, dreamy',
    main_subject: 'Delicate flower petals in macro',
    main_colors: {
      rose_pink: '#E91E63',
      soft_pink: '#F8BBD9',
      leaf_green: '#4CAF50',
      white: '#FFFFFF',
    },
    exif: {
      FileName: 'DSC_8765.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 100,
      FNumber: 2.8,
      ExposureTime: '1/250',
      FocalLength: '105mm',
      DateTimeOriginal: '2021:04:22 09:15:30',
      ImageWidth: 3200,
      ImageHeight: 2133,
    },
    embedding: {
      clip: generateMockEmbedding(10),
      description: generateMockEmbedding(110),
    },
  },
  {
    id: 'img_011',
    filename: 'DSC_3345.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1480714378408-67cf0d13bc1b?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1480714378408-67cf0d13bc1b?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1480714378408-67cf0d13bc1b?w=1920`,
    },
    description: "Towering skyscrapers stand silhouetted against a dramatic sunset sky painted in vivid shades of orange, pink, and purple. The city transitions from day to night as lights begin to flicker on in countless windows. The bold contrast between the dark buildings and the fiery sky creates a striking urban landscape.",
    tags: {
      cityscape: ['skyline', 'skyscrapers', 'silhouette', 'urban'],
      sky: ['sunset', 'dramatic', 'colorful', 'dusk'],
      time: ['golden-hour', 'evening', 'transition'],
    },
    mood: 'Dramatic, transitional, urban, inspiring',
    main_subject: 'City skyline at sunset',
    main_colors: {
      sunset_orange: '#FF6B35',
      deep_purple: '#9B59B6',
      building_dark: '#2C3E50',
      pink: '#E74C3C',
    },
    exif: {
      FileName: 'DSC_3345.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 100,
      FNumber: 8,
      ExposureTime: '1/250',
      FocalLength: '50mm',
      DateTimeOriginal: '2020:06:21 20:45:15',
      ImageWidth: 4000,
      ImageHeight: 2250,
    },
    embedding: {
      clip: generateMockEmbedding(11),
      description: generateMockEmbedding(111),
    },
  },
  {
    id: 'img_012',
    filename: 'DSC_0192.jpg',
    urls: {
      small: `${IMAGE_BASE_URL}/photo-1531366936337-7c912a4589a7?w=200`,
      medium: `${IMAGE_BASE_URL}/photo-1531366936337-7c912a4589a7?w=800`,
      full: `${IMAGE_BASE_URL}/photo-1531366936337-7c912a4589a7?w=1920`,
    },
    description: "Ethereal curtains of green and purple light dance across the Arctic sky in a mesmerizing display of the Aurora Borealis. The Northern Lights create shifting patterns above a snow-covered landscape dotted with sparse evergreens. Stars peek through the cosmic display, adding to the otherworldly atmosphere.",
    tags: {
      sky: ['aurora', 'northern-lights', 'stars', 'night'],
      landscape: ['arctic', 'snow', 'wilderness', 'tundra'],
      phenomenon: ['natural', 'celestial', 'magnetic'],
    },
    mood: 'Magical, ethereal, awe-inspiring, mystical',
    main_subject: 'Aurora borealis over snowy landscape',
    main_colors: {
      aurora_green: '#00FF7F',
      aurora_purple: '#9B59B6',
      night_sky: '#1A1A2E',
      snow_blue: '#3498DB',
    },
    exif: {
      FileName: 'DSC_0192.jpg',
      Make: 'NIKON CORPORATION',
      Model: 'NIKON D850',
      ISO: 3200,
      FNumber: 2.8,
      ExposureTime: '15',
      FocalLength: '14mm',
      DateTimeOriginal: '2023:01:15 23:45:00',
      ImageWidth: 4200,
      ImageHeight: 2800,
    },
    embedding: {
      clip: generateMockEmbedding(12),
      description: generateMockEmbedding(112),
    },
  },
];

// Helper to get all unique tags across all categories
export const getAllTags = (): string[] => {
  const tags = new Set<string>();
  mockImages.forEach((img) => {
    Object.values(img.tags).forEach((tagArray) => {
      tagArray.forEach((t) => tags.add(t));
    });
  });
  return Array.from(tags).sort();
};

// Helper to get all tag categories
export const getTagCategories = (): string[] => {
  const categories = new Set<string>();
  mockImages.forEach((img) => {
    Object.keys(img.tags).forEach((cat) => categories.add(cat));
  });
  return Array.from(categories).sort();
};

// Helper to get all unique moods
export const getAllMoods = (): string[] => {
  const moods = new Set<string>();
  mockImages.forEach((img) => {
    img.mood.split(/[,\s]+/).forEach((m) => {
      const trimmed = m.trim().toLowerCase();
      if (trimmed) moods.add(trimmed);
    });
  });
  return Array.from(moods).sort();
};

// Helper to get all main subjects
export const getAllSubjects = (): string[] => {
  return mockImages.map((img) => img.main_subject);
};

// Helper to get color families from all images
export const getColorFamilies = (): Record<string, string[]> => {
  const colors: Record<string, string[]> = {
    warm: [],
    cool: [],
    neutral: [],
  };
  
  mockImages.forEach((img) => {
    Object.entries(img.main_colors).forEach(([name, hex]) => {
      const nameLower = name.toLowerCase();
      if (nameLower.includes('orange') || nameLower.includes('red') || nameLower.includes('gold') || nameLower.includes('amber') || nameLower.includes('warm')) {
        colors.warm.push(hex);
      } else if (nameLower.includes('blue') || nameLower.includes('green') || nameLower.includes('teal') || nameLower.includes('cyan')) {
        colors.cool.push(hex);
      } else {
        colors.neutral.push(hex);
      }
    });
  });
  
  return colors;
};

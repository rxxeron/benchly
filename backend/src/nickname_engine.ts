/**
 * Server-side Eclectic Nickname Engine for Benchly.
 * Draws from nature, wildlife, Dhaka/campus food & culture, music, art,
 * cosmic aesthetics, and expressive personas — intentionally zero coding/gaming clichés.
 */

export const NICKNAME_ADJECTIVES: string[] = [
    'Velvet', 'Monsoon', 'Golden', 'Midnight', 'Solar', 'Lunar',
    'Saffron', 'Cinnamon', 'Amber', 'Indigo', 'Breezy', 'Starlit',
    'Cosmic', 'Rainy', 'Chaotic', 'Mellow', 'Dreamy', 'Electric',
    'Smoky', 'Crisp', 'Neon', 'Silent', 'Wild', 'Wandering',
    'Sleepy', 'Magnetic', 'Restless', 'Radiant', 'Rustic', 'Vintage',
    'Crimson', 'Emerald', 'Misty', 'Cloudy', 'Spiced', 'Honey',
    'Silver', 'Twilight', 'Cobalt', 'Lush', 'Astral', 'Sunlit',
    'Rogue', 'Caffeinated', 'Wistful', 'Dusk', 'Boho', 'Velvety',
];

export const NICKNAME_NOUNS: string[] = [
    // Nature & Wildlife
    'Panther', 'Firefly', 'Albatross', 'Otter', 'Heron', 'Fox',
    'Koi', 'Sparrow', 'Lotus', 'Banyan', 'Mirage', 'Comet',
    'Horizon', 'Zephyr', 'Eclipse', 'Aurora', 'Pebble', 'Falcon',
    // Food & Dhaka / Campus Hangout
    'Fuchka', 'Espresso', 'Matcha', 'Croissant', 'Boba', 'Biryani',
    'Mango', 'Jhalmuri', 'Chai', 'Tangerine', 'Pretzel', 'Caramel',
    // Art, Music & Culture
    'Vinyl', 'Polaroid', 'Sketchbook', 'Jazz', 'Cinema', 'Origami',
    'Sonnet', 'Mosaic', 'Cassette', 'Lantern', 'Compass', 'Melody',
    // Vibes & Personas
    'Nomad', 'Drifter', 'Stargazer', 'Daydreamer', 'Storyteller',
    'Alchemist', 'Voyager', 'Maverick', 'Muse', 'Poet',
    'Wanderer', 'Riddle', 'Whisper', 'Echo', 'Vagabond', 'Phantom',
];

export function generateServerNickname(): string {
    const adj = NICKNAME_ADJECTIVES[Math.floor(Math.random() * NICKNAME_ADJECTIVES.length)];
    let noun = NICKNAME_NOUNS[Math.floor(Math.random() * NICKNAME_NOUNS.length)];
    while (noun === adj) {
        noun = NICKNAME_NOUNS[Math.floor(Math.random() * NICKNAME_NOUNS.length)];
    }
    const num = Math.floor(Math.random() * 90) + 10;
    return `${adj} ${noun} ${num}`;
}

export function generateServerNicknameBatch(count = 6): string[] {
    const out = new Set<string>();
    let guard = 0;
    while (out.size < count && guard < 100) {
        out.add(generateServerNickname());
        guard++;
    }
    return Array.from(out);
}

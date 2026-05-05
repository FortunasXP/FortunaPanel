// FortunaPanel - Configuration File Definitions
// Metadata for structured editing of Minecraft config files

/**
 * Each definition maps a config file to its property definitions.
 * Properties are grouped by category for UI rendering.
 *
 * Property types: 'boolean', 'number', 'string', 'select'
 */

export const CONFIG_DEFINITIONS = {
    'bukkit.yml': {
        label: 'Bukkit Configuration',
        properties: {
            // Settings
            'settings.allow-end': { type: 'boolean', default: true, description: 'Allow the End dimension', category: 'World' },
            'settings.warn-on-overload': { type: 'boolean', default: true, description: 'Warn when server is overloaded', category: 'Performance' },
            'settings.permissions-file': { type: 'string', default: 'permissions.yml', description: 'Permissions file name', category: 'General' },
            'settings.update-folder': { type: 'string', default: 'update', description: 'Plugin update folder', category: 'General' },
            'settings.plugin-profiling': { type: 'boolean', default: false, description: 'Enable plugin profiling', category: 'Performance' },
            'settings.connection-throttle': { type: 'number', default: 4000, description: 'Connection throttle (ms)', category: 'Network', min: 0, max: 60000 },
            'settings.query-plugins': { type: 'boolean', default: true, description: 'Show plugins in query response', category: 'Network' },
            'settings.deprecated-verbose': { type: 'select', default: 'default', description: 'Deprecated API logging', category: 'General', options: ['default', 'false', 'true'] },
            'settings.minimum-api': { type: 'string', default: 'none', description: 'Minimum Bukkit API version', category: 'General' },
            // Spawn limits
            'spawn-limits.monsters': { type: 'number', default: 70, description: 'Monster spawn limit per world', category: 'Spawn Limits', min: 0, max: 1000 },
            'spawn-limits.animals': { type: 'number', default: 10, description: 'Animal spawn limit per world', category: 'Spawn Limits', min: 0, max: 1000 },
            'spawn-limits.water-animals': { type: 'number', default: 5, description: 'Water animal spawn limit', category: 'Spawn Limits', min: 0, max: 1000 },
            'spawn-limits.water-ambient': { type: 'number', default: 20, description: 'Water ambient spawn limit', category: 'Spawn Limits', min: 0, max: 1000 },
            'spawn-limits.water-underground-creature': { type: 'number', default: 5, description: 'Underground water creature limit', category: 'Spawn Limits', min: 0, max: 1000 },
            'spawn-limits.axolotls': { type: 'number', default: 5, description: 'Axolotl spawn limit', category: 'Spawn Limits', min: 0, max: 1000 },
            'spawn-limits.ambient': { type: 'number', default: 15, description: 'Ambient mob spawn limit', category: 'Spawn Limits', min: 0, max: 1000 },
            // Tick rates
            'ticks-per.animal-spawns': { type: 'number', default: 400, description: 'Ticks between animal spawns', category: 'Tick Rates', min: 1, max: 10000 },
            'ticks-per.monster-spawns': { type: 'number', default: 1, description: 'Ticks between monster spawns', category: 'Tick Rates', min: 1, max: 10000 },
            'ticks-per.water-spawns': { type: 'number', default: 1, description: 'Ticks between water spawns', category: 'Tick Rates', min: 1, max: 10000 },
            'ticks-per.water-ambient-spawns': { type: 'number', default: 1, description: 'Ticks between water ambient spawns', category: 'Tick Rates', min: 1, max: 10000 },
            'ticks-per.ambient-spawns': { type: 'number', default: 1, description: 'Ticks between ambient spawns', category: 'Tick Rates', min: 1, max: 10000 },
            'ticks-per.autosave': { type: 'number', default: 6000, description: 'Ticks between autosaves', category: 'Tick Rates', min: 100, max: 72000 },
        }
    },

    'spigot.yml': {
        label: 'Spigot Configuration',
        properties: {
            // Settings
            'settings.bungeecord': { type: 'boolean', default: false, description: 'Enable BungeeCord support', category: 'Network' },
            'settings.netty-threads': { type: 'number', default: 4, description: 'Netty I/O threads', category: 'Network', min: 1, max: 16 },
            'settings.timeout-time': { type: 'number', default: 60, description: 'Server timeout (seconds)', category: 'Network', min: 10, max: 900 },
            'settings.restart-on-crash': { type: 'boolean', default: true, description: 'Restart on crash', category: 'General' },
            'settings.restart-script': { type: 'string', default: './start.sh', description: 'Restart script path', category: 'General' },
            'settings.save-user-cache-on-stop-only': { type: 'boolean', default: false, description: 'Save user cache only on stop', category: 'Performance' },
            'settings.moved-wrongly-threshold': { type: 'number', default: 0.0625, description: 'Movement error threshold', category: 'Anti-Cheat' },
            'settings.moved-too-quickly-multiplier': { type: 'number', default: 10.0, description: 'Speed check multiplier', category: 'Anti-Cheat' },
            'settings.log-villager-deaths': { type: 'boolean', default: true, description: 'Log villager deaths', category: 'General' },
            'settings.log-named-deaths': { type: 'boolean', default: true, description: 'Log named entity deaths', category: 'General' },
            // Commands
            'commands.replace-commands': { type: 'string', default: 'setblock,summon,testforblock,tellraw', description: 'Commands to replace', category: 'Commands' },
            'commands.spam-exclusions': { type: 'string', default: '/skill', description: 'Spam filter exclusions', category: 'Commands' },
            'commands.silent-commandblock-console': { type: 'boolean', default: false, description: 'Silence command block output', category: 'Commands' },
            'commands.log': { type: 'boolean', default: true, description: 'Log commands to console', category: 'Commands' },
            'commands.tab-complete': { type: 'number', default: 0, description: 'Tab-complete threshold', category: 'Commands', min: -1, max: 100 },
            'commands.send-namespaced': { type: 'boolean', default: true, description: 'Send namespaced commands', category: 'Commands' },
            // World settings
            'world-settings.default.view-distance': { type: 'number', default: 10, description: 'Default view distance', category: 'World', min: 2, max: 32 },
            'world-settings.default.simulation-distance': { type: 'number', default: 10, description: 'Default simulation distance', category: 'World', min: 2, max: 32 },
            'world-settings.default.mob-spawn-range': { type: 'number', default: 8, description: 'Mob spawn range (chunks)', category: 'World', min: 1, max: 16 },
            'world-settings.default.entity-activation-range.animals': { type: 'number', default: 32, description: 'Animal activation range', category: 'Entity Activation', min: 1, max: 256 },
            'world-settings.default.entity-activation-range.monsters': { type: 'number', default: 32, description: 'Monster activation range', category: 'Entity Activation', min: 1, max: 256 },
            'world-settings.default.entity-activation-range.raiders': { type: 'number', default: 48, description: 'Raider activation range', category: 'Entity Activation', min: 1, max: 256 },
            'world-settings.default.entity-activation-range.misc': { type: 'number', default: 16, description: 'Misc entity activation range', category: 'Entity Activation', min: 1, max: 256 },
            'world-settings.default.entity-tracking-range.players': { type: 'number', default: 48, description: 'Player tracking range', category: 'Entity Tracking', min: 1, max: 256 },
            'world-settings.default.entity-tracking-range.animals': { type: 'number', default: 48, description: 'Animal tracking range', category: 'Entity Tracking', min: 1, max: 256 },
            'world-settings.default.entity-tracking-range.monsters': { type: 'number', default: 48, description: 'Monster tracking range', category: 'Entity Tracking', min: 1, max: 256 },
            'world-settings.default.entity-tracking-range.misc': { type: 'number', default: 32, description: 'Misc tracking range', category: 'Entity Tracking', min: 1, max: 256 },
            'world-settings.default.entity-tracking-range.display': { type: 'number', default: 128, description: 'Display tracking range', category: 'Entity Tracking', min: 1, max: 256 },
            'world-settings.default.merge-radius.item': { type: 'number', default: 2.5, description: 'Item merge radius', category: 'Performance' },
            'world-settings.default.merge-radius.exp': { type: 'number', default: 3.0, description: 'XP merge radius', category: 'Performance' },
            'world-settings.default.item-despawn-rate': { type: 'number', default: 6000, description: 'Item despawn rate (ticks)', category: 'Performance', min: 100, max: 72000 },
            'world-settings.default.nerf-spawner-mobs': { type: 'boolean', default: false, description: 'Nerf spawner mobs (reduce AI)', category: 'Performance' },
            'world-settings.default.max-tnt-per-tick': { type: 'number', default: 100, description: 'Max TNT per tick', category: 'Performance', min: 1, max: 1000 },
            'world-settings.default.hopper-amount': { type: 'number', default: 1, description: 'Hopper transfer amount', category: 'Performance', min: 1, max: 64 },
        }
    },

    'config/paper-global.yml': {
        label: 'Paper Global Configuration',
        properties: {
            'proxies.velocity.enabled': { type: 'boolean', default: false, description: 'Enable Velocity support', category: 'Proxy' },
            'proxies.velocity.online-mode': { type: 'boolean', default: false, description: 'Velocity online mode', category: 'Proxy' },
            'proxies.velocity.secret': { type: 'string', default: '', description: 'Velocity forwarding secret', category: 'Proxy' },
            'proxies.bungee-cord.online-mode': { type: 'boolean', default: true, description: 'BungeeCord online mode', category: 'Proxy' },
            'timings.enabled': { type: 'boolean', default: true, description: 'Enable Timings profiler', category: 'Performance' },
            'timings.verbose': { type: 'boolean', default: true, description: 'Verbose timings output', category: 'Performance' },
            'timings.url': { type: 'string', default: 'https://timings.aikar.co/', description: 'Timings upload URL', category: 'Performance' },
            'timings.server-name-privacy': { type: 'boolean', default: false, description: 'Anonymize server name in timings', category: 'Performance' },
            'messages.no-permission': { type: 'string', default: 'I\'m sorry, but you do not have permission to perform this command.', description: 'No permission message', category: 'Messages' },
            'messages.kick.connection-throttle': { type: 'string', default: 'Connection throttled! Please wait before reconnecting.', description: 'Connection throttle kick message', category: 'Messages' },
            'messages.kick.flying-player': { type: 'string', default: 'Flying is not enabled on this server', description: 'Flying kick message', category: 'Messages' },
            'messages.kick.flying-vehicle': { type: 'string', default: 'Flying is not enabled on this server', description: 'Vehicle flying kick message', category: 'Messages' },
            'packet-limiter.kick-message': { type: 'string', default: 'Too many packets!', description: 'Packet limiter kick message', category: 'Network' },
            'misc.max-joins-per-tick': { type: 'number', default: 5, description: 'Max player joins per tick', category: 'Network', min: 1, max: 100 },
            'misc.fix-entity-position-desync': { type: 'boolean', default: true, description: 'Fix entity position desync', category: 'Performance' },
            'chunk-loading-basic.autoconfig-send-distance': { type: 'boolean', default: true, description: 'Auto-configure send distance', category: 'Chunks' },
            'chunk-loading-basic.player-max-chunk-send-rate': { type: 'number', default: -1, description: 'Max chunk send rate (-1 for auto)', category: 'Chunks' },
            'chunk-loading-basic.player-max-chunk-load-rate': { type: 'number', default: -1, description: 'Max chunk load rate (-1 for auto)', category: 'Chunks' },
            'unsupported-settings.allow-headless-pistons': { type: 'boolean', default: false, description: 'Allow headless pistons', category: 'Unsupported' },
            'unsupported-settings.allow-permanent-block-break-exploits': { type: 'boolean', default: false, description: 'Allow block break exploits', category: 'Unsupported' },
            'unsupported-settings.allow-piston-duplication': { type: 'boolean', default: false, description: 'Allow piston duplication', category: 'Unsupported' },
        }
    },

    'config/paper-world-defaults.yml': {
        label: 'Paper World Defaults',
        properties: {
            'entities.spawning.per-player-mob-spawns': { type: 'boolean', default: true, description: 'Per-player mob spawning', category: 'Spawning' },
            'entities.spawning.creative-arrow-despawn-rate.default': { type: 'number', default: -1, description: 'Creative arrow despawn (-1=default)', category: 'Spawning' },
            'entities.spawning.non-player-arrow-despawn-rate.default': { type: 'number', default: -1, description: 'Non-player arrow despawn (-1=default)', category: 'Spawning' },
            'entities.spawning.despawn-ranges.monster.soft': { type: 'number', default: 32, description: 'Monster soft despawn range', category: 'Spawning', min: 1, max: 256 },
            'entities.spawning.despawn-ranges.monster.hard': { type: 'number', default: 128, description: 'Monster hard despawn range', category: 'Spawning', min: 1, max: 256 },
            'entities.behavior.disable-chest-cat-detection': { type: 'boolean', default: false, description: 'Disable cat chest detection', category: 'Entities' },
            'entities.behavior.spawner-nerfed-mobs-should-jump': { type: 'boolean', default: false, description: 'Nerfed mobs can jump', category: 'Entities' },
            'entities.behavior.zombie-villager-infection-chance.default': { type: 'number', default: -1, description: 'Zombie infection chance (-1=default)', category: 'Entities' },
            'environment.treasure-maps.enabled': { type: 'boolean', default: true, description: 'Enable treasure maps', category: 'Environment' },
            'environment.treasure-maps.find-already-discovered.villager-trade': { type: 'boolean', default: false, description: 'Maps find discovered structures (villager)', category: 'Environment' },
            'environment.treasure-maps.find-already-discovered.loot-tables': { type: 'boolean', default: false, description: 'Maps find discovered structures (loot)', category: 'Environment' },
            'environment.nether-ceiling-void-damage-height.enabled': { type: 'boolean', default: false, description: 'Enable nether ceiling void damage', category: 'Environment' },
            'environment.optimize-explosions': { type: 'boolean', default: false, description: 'Optimize explosions', category: 'Performance' },
            'chunks.auto-save-interval.default': { type: 'number', default: -1, description: 'Auto-save interval (-1=global)', category: 'Chunks' },
            'chunks.prevent-moving-into-unloaded-chunks': { type: 'boolean', default: false, description: 'Prevent moving into unloaded chunks', category: 'Chunks' },
            'chunks.max-auto-save-chunks-per-tick': { type: 'number', default: 24, description: 'Max autosave chunks per tick', category: 'Chunks', min: 1, max: 100 },
            'collisions.max-entity-collisions': { type: 'number', default: 8, description: 'Max entity collisions', category: 'Performance', min: 0, max: 64 },
            'collisions.allow-player-cramming-damage': { type: 'boolean', default: false, description: 'Allow cramming damage to players', category: 'Gameplay' },
            'misc.redstone-implementation': { type: 'select', default: 'VANILLA', description: 'Redstone implementation', category: 'Performance', options: ['VANILLA', 'EIGENCRAFT', 'ALTERNATE_CURRENT'] },
            'misc.disable-relative-projectile-velocity': { type: 'boolean', default: false, description: 'Disable relative projectile velocity', category: 'Gameplay' },
            'misc.max-leash-distance.default': { type: 'number', default: 10, description: 'Max leash distance', category: 'Gameplay' },
            'tick-rates.mob-spawner': { type: 'number', default: 1, description: 'Mob spawner tick rate', category: 'Performance', min: 1, max: 100 },
            'tick-rates.sensor.villager.secondarypoisensor': { type: 'number', default: 40, description: 'Villager secondary POI sensor rate', category: 'Performance', min: 1, max: 200 },
        }
    },

    'velocity.toml': {
        label: 'Velocity Proxy Configuration',
        properties: {
            'config-version': { type: 'string', default: '2.7', description: 'Config file version', category: 'General' },
            'bind': { type: 'string', default: '0.0.0.0:25577', description: 'Bind address and port', category: 'Network' },
            'motd': { type: 'string', default: '&#09a Velocity Server', description: 'Server MOTD', category: 'General' },
            'show-max-players': { type: 'number', default: 500, description: 'Max players shown in server list', category: 'General', min: 0, max: 10000 },
            'online-mode': { type: 'boolean', default: true, description: 'Online mode (Mojang auth)', category: 'Network' },
            'force-key-authentication': { type: 'boolean', default: true, description: 'Force chat key authentication', category: 'Network' },
            'prevent-client-proxy-connections': { type: 'boolean', default: false, description: 'Prevent proxy client connections', category: 'Network' },
            'player-info-forwarding-mode': { type: 'select', default: 'NONE', description: 'Player info forwarding mode', category: 'Proxy', options: ['NONE', 'LEGACY', 'BUNGEEGUARD', 'MODERN'] },
            'forwarding-secret-file': { type: 'string', default: 'forwarding.secret', description: 'Forwarding secret file', category: 'Proxy' },
            'announce-forge': { type: 'boolean', default: false, description: 'Announce Forge support', category: 'General' },
            'kick-existing-players': { type: 'boolean', default: false, description: 'Kick existing player on duplicate join', category: 'Network' },
            'ping-passthrough': { type: 'select', default: 'DISABLED', description: 'Ping passthrough mode', category: 'Network', options: ['DISABLED', 'MODS', 'DESCRIPTION', 'ALL'] },
            'enable-player-address-logging': { type: 'boolean', default: true, description: 'Log player IP addresses', category: 'General' },
            // Advanced
            'advanced.compression-threshold': { type: 'number', default: 256, description: 'Compression threshold (bytes)', category: 'Advanced', min: -1, max: 65535 },
            'advanced.compression-level': { type: 'number', default: -1, description: 'Compression level (-1 for default)', category: 'Advanced', min: -1, max: 9 },
            'advanced.login-ratelimit': { type: 'number', default: 3000, description: 'Login rate limit (ms)', category: 'Advanced', min: 0, max: 60000 },
            'advanced.connection-timeout': { type: 'number', default: 5000, description: 'Connection timeout (ms)', category: 'Advanced', min: 1000, max: 30000 },
            'advanced.read-timeout': { type: 'number', default: 30000, description: 'Read timeout (ms)', category: 'Advanced', min: 1000, max: 120000 },
            'advanced.haproxy-protocol': { type: 'boolean', default: false, description: 'Enable HAProxy PROXY protocol', category: 'Advanced' },
            'advanced.tcp-fast-open': { type: 'boolean', default: false, description: 'Enable TCP Fast Open', category: 'Advanced' },
            'advanced.bungee-plugin-message-channel': { type: 'boolean', default: true, description: 'BungeeCord plugin messaging', category: 'Advanced' },
            'advanced.show-ping-requests': { type: 'boolean', default: false, description: 'Log ping requests', category: 'Advanced' },
            'advanced.failover-on-unexpected-server-disconnect': { type: 'boolean', default: true, description: 'Failover on unexpected disconnect', category: 'Advanced' },
            // Query
            'query.enabled': { type: 'boolean', default: false, description: 'Enable GameSpy4 query', category: 'Query' },
            'query.port': { type: 'number', default: 25577, description: 'Query port', category: 'Query', min: 1, max: 65535 },
        }
    }
};

/**
 * Get config definition for a file, or null if no structured definition exists.
 */
export function getConfigDefinition(fileName) {
    return CONFIG_DEFINITIONS[fileName] || null;
}

/**
 * Get the categories from a config definition, for rendering sections.
 */
export function getCategories(definition) {
    const categories = new Map();
    for (const [key, prop] of Object.entries(definition.properties)) {
        const cat = prop.category || 'General';
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat).push({ key, ...prop });
    }
    return categories;
}

/*
 * Conversion Quest: Sales Wars
 *
 * This game recreates a tongue‑in‑cheek sales experience inspired by
 * early top‑down shooters like the original Grand Theft Auto and the SNES
 * classic Zombies Ate My Neighbors. Three distinct stages mimic a mall
 * perfume counter, a shoe store and a car lot. Each level introduces a
 * unique projectile mechanic (spray, boomerang shoe and key scatter) and
 * progressively more complex environments. Players must convert as many
 * shoppers as possible before the timer expires while avoiding or
 * overcoming friction events that chase and bruise them. A high
 * conversion rate unlocks a “Finish Him” sequence borrowed from Mortal
 * Kombat style fatalities. See README.md for more narrative details.
 */

// Configuration for the Phaser game. All scenes are declared below.
const gameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  backgroundColor: '#1a1a1a',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  scene: [],
};

// Global lead definitions. Each lead type defines how many hits it takes
// to convert them, how fast they move and what colour they appear as.
const LEAD_TYPES = {
  warm: { requiredHits: 1, speed: 40, color: 0x00b050, value: 1, cta: 'Launch Kit Activated!' },
  cold: { requiredHits: 2, speed: 30, color: 0xffd966, value: 2, cta: 'Growth Stack Unlocked!' },
  reluctant: { requiredHits: 1, speed: 80, color: 0xc00000, value: 3, cta: 'Scale Suite Deployed!' },
};

/**
 * Base class for all playable levels. Specific stages override the
 * configuration passed to the constructor. The base class handles
 * spawning leads, friction pursuers, projectiles, health/morale and
 * overall level progression.
 */
class LevelScene extends Phaser.Scene {
  /**
   * Construct a new level.
   * @param {string} key Unique scene key.
   * @param {Object} cfg Stage configuration: projectileType ('spray'|'shoe'|'keys'),
   *  number (1–3) and optional layout function.
   */
  constructor(key, cfg) {
    super({ key });
    this.levelKey = key;
    this.levelNumber = cfg.number;
    this.projectileType = cfg.projectileType;
    this.setupLayout = cfg.setupLayout || (() => {});
  }

  create() {
    // Stage state variables
    this.converted = 0;
    this.totalLeads = 0;
    this.timer = 90; // seconds per level
    this.health = 100;
    this.frictionCounter = 0;
    this.gameOver = false;
    this.finishTriggered = false;

    // Create UI elements
    this.timerText = this.add.text(10, 10, 'Time: 90', {
      fontSize: '18px',
      fill: '#fff',
    });
    this.scoreText = this.add.text(10, 30, 'Converted: 0', {
      fontSize: '18px',
      fill: '#fff',
    });
    this.rateText = this.add.text(10, 50, 'Rate: 0%', {
      fontSize: '18px',
      fill: '#fff',
    });
    // CTA message text. Initially invisible.
    this.ctaText = this.add.text(this.cameras.main.centerX, 560, '', {
      fontSize: '20px',
      fill: '#ffd966',
      align: 'center',
    }).setOrigin(0.5).setAlpha(0);

    // Morale bar background and foreground
    this.healthBarBg = this.add.rectangle(650, 20, 120, 12, 0x444444).setOrigin(0, 0.5);
    this.healthBar = this.add.rectangle(650, 20, 120, 12, 0x00b0f0).setOrigin(0, 0.5);
    this.healthLabel = this.add.text(650, 35, 'Morale', {
      fontSize: '12px',
      fill: '#fff',
    }).setOrigin(0, 0);

    // Player sprite. Use a simple circle for a retro look.
    this.player = this.physics.add.circle(400, 300, 10, 0xffffff);
    this.player.setCollideWorldBounds(true);

    // Groups for leads, projectiles and friction pursuers
    this.leads = this.physics.add.group();
    this.projectiles = this.physics.add.group();
    this.frictionGroup = this.physics.add.group();

    // Initialise keyboard controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.actionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Setup collisions
    this.physics.add.overlap(this.projectiles, this.leads, this.handleProjectileLead, null, this);
    this.physics.add.overlap(this.player, this.frictionGroup, this.handleFrictionHit, null, this);

    // Some levels include static obstacles; call setup function
    this.setupLayout();
    // Collide player/leads/friction against walls if defined
    if (this.walls) {
      this.physics.add.collider(this.player, this.walls);
      this.physics.add.collider(this.leads, this.walls);
      this.physics.add.collider(this.frictionGroup, this.walls);
    }

    // Spawn leads periodically; spawn rate increases as timer counts down
    this.spawnEvent = this.time.addEvent({
      delay: 2000,
      callback: this.spawnLead,
      callbackScope: this,
      loop: true,
    });

    // Setup friction events with random delays. Will fire up to 2 times per level.
    this.scheduleNextFriction();

    // Countdown timer
    this.timeEvent = this.time.addEvent({
      delay: 1000,
      callback: () => {
        if (this.gameOver) return;
        this.timer--;
        if (this.timer <= 0) {
          this.endLevel();
        }
        this.timerText.setText(`Time: ${this.timer}`);
      },
      callbackScope: this,
      loop: true,
    });

    // Conversion bar update will be done in convertLead
  }

  /** Schedule the next friction event with a random delay. */
  scheduleNextFriction() {
    if (this.frictionCounter >= 2) return;
    const delay = Phaser.Math.Between(15000, 30000);
    this.frictionTimer = this.time.addEvent({
      delay: delay,
      callback: this.triggerFriction,
      callbackScope: this,
    });
  }

  /** Create a friction pursuer that chases the player for 15 seconds. */
  triggerFriction() {
    if (this.frictionCounter >= 2) return;
    this.frictionCounter++;
    // Create pursuer at random edge
    const x = Phaser.Math.Between(0, 1) ? 0 : this.scale.width;
    const y = Phaser.Math.Between(50, this.scale.height - 50);
    const friction = this.physics.add.circle(x, y, 14, 0xff00ff);
    friction.speed = 120;
    friction.startTime = this.time.now;
    this.frictionGroup.add(friction);
    // Remove after 15 seconds
    this.time.addEvent({
      delay: 15000,
      callback: () => {
        friction.destroy();
      },
    });
    // Schedule next friction event if more remain
    this.scheduleNextFriction();
  }

  /** Spawn a new lead with random type and initial velocity. */
  spawnLead() {
    if (this.gameOver) return;
    // Decide lead type based on simple probabilities
    const r = Math.random();
    let typeName;
    if (r < 0.6) {
      typeName = 'warm';
    } else if (r < 0.9) {
      typeName = 'cold';
    } else {
      typeName = 'reluctant';
    }
    const def = LEAD_TYPES[typeName];
    // Create lead as a small circle
    const lead = this.physics.add.circle(
      Phaser.Math.Between(50, this.scale.width - 50),
      Phaser.Math.Between(50, this.scale.height - 50),
      8,
      def.color
    );
    lead.typeName = typeName;
    lead.requiredHits = def.requiredHits;
    lead.hitsReceived = 0;
    lead.speed = def.speed;
    // Random velocity direction
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    lead.body.setVelocity(Math.cos(angle) * def.speed, Math.sin(angle) * def.speed);
    lead.body.setCollideWorldBounds(true);
    lead.body.setBounce(1, 1);
    this.leads.add(lead);
    this.totalLeads++;
  }

  /** Handle projectile overlapping a lead. */
  handleProjectileLead(projectile, lead) {
    projectile.destroy();
    lead.hitsReceived++;
    if (lead.hitsReceived >= lead.requiredHits) {
      this.convertLead(lead);
    }
  }

  /** When the player collides with a friction pursuer, lose morale and show blood. */
  handleFrictionHit(player, friction) {
    friction.destroy();
    this.health -= 20;
    if (this.health < 0) this.health = 0;
    // Spawn a small blood splat at the player's position
    const blood = this.add.circle(player.x, player.y, 6, 0xaa0000);
    this.tweens.add({ targets: blood, alpha: 0, scale: 2, duration: 1000, onComplete: () => blood.destroy() });
    this.updateHealthBar();
    if (this.health <= 0) {
      this.gameOver = true;
      this.scene.start('GameOver');
    }
  }

  /** Convert a lead into a sale. */
  convertLead(lead) {
    // Remove lead
    lead.destroy();
    this.converted++;
    // Update text
    this.scoreText.setText(`Converted: ${this.converted}`);
    const rate = this.totalLeads ? (this.converted / this.totalLeads) * 100 : 0;
    this.rateText.setText(`Rate: ${rate.toFixed(0)}%`);
    // Show CTA message based on lead type
    const msg = LEAD_TYPES[lead.typeName].cta;
    this.ctaText.setText(msg);
    this.ctaText.setAlpha(1);
    this.tweens.add({ targets: this.ctaText, alpha: 0, duration: 1500, delay: 500 });
  }

  /** Shoot a projectile based on the current stage. */
  shootProjectile() {
    if (this.projectileType === 'spray') {
      // Spray: short‑range shot directly toward pointer
      const pointer = this.input.activePointer;
      const bullet = this.physics.add.circle(this.player.x, this.player.y, 4, 0x80c342);
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
      const speed = 300;
      bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      bullet.lifespan = 500;
      this.projectiles.add(bullet);
    } else if (this.projectileType === 'shoe') {
      // Shoe: boomerang that returns after some time
      const pointer = this.input.activePointer;
      const bullet = this.physics.add.circle(this.player.x, this.player.y, 4, 0x0088ff);
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
      const speed = 250;
      bullet.returning = false;
      bullet.startTime = this.time.now;
      bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      bullet.update = () => {
        const elapsed = this.time.now - bullet.startTime;
        if (!bullet.returning && elapsed > 400) {
          bullet.returning = true;
        }
        if (bullet.returning) {
          const a = Phaser.Math.Angle.Between(bullet.x, bullet.y, this.player.x, this.player.y);
          bullet.body.setVelocity(Math.cos(a) * speed, Math.sin(a) * speed);
          if (Phaser.Math.Distance.Between(bullet.x, bullet.y, this.player.x, this.player.y) < 12) {
            bullet.destroy();
          }
        }
      };
      this.projectiles.add(bullet);
    } else if (this.projectileType === 'keys') {
      // Keys: scatter multiple projectiles in radial directions
      const num = 5;
      const speed = 250;
      for (let i = 0; i < num; i++) {
        const angle = (i / num) * Math.PI * 2;
        const bullet = this.physics.add.circle(this.player.x, this.player.y, 4, 0xffaa00);
        bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
        bullet.lifespan = 800;
        this.projectiles.add(bullet);
      }
    }
  }

  /** Update the health (morale) bar width based on current health. */
  updateHealthBar() {
    const width = 120 * (this.health / 100);
    this.healthBar.width = width;
    // Colour shifts from blue to red as morale decreases
    const colour = Phaser.Display.Color.Interpolate.ColorWithColor(
      new Phaser.Display.Color(0, 176, 240),
      new Phaser.Display.Color(192, 0, 0),
      100,
      100 - this.health
    );
    const tint = Phaser.Display.Color.GetColor(colour.r, colour.g, colour.b);
    this.healthBar.fillColor = tint;
  }

  /** Called each frame to handle movement and bullet updates. */
  update(time, delta) {
    if (this.gameOver) return;
    // Player movement based on cursors or WASD
    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.keyA.isDown) vx = -1;
    else if (this.cursors.right.isDown || this.keyD.isDown) vx = 1;
    if (this.cursors.up.isDown || this.keyW.isDown) vy = -1;
    else if (this.cursors.down.isDown || this.keyS.isDown) vy = 1;
    const speed = 200;
    this.player.body.setVelocity(vx * speed, vy * speed);

    // Shoot projectile on space press
    if (Phaser.Input.Keyboard.JustDown(this.actionKey)) {
      this.shootProjectile();
    }

    // Update custom projectile behaviour (boomerangs) and lifespan for others
    this.projectiles.getChildren().forEach((proj) => {
      if (proj.update) {
        proj.update();
      }
      if (proj.lifespan) {
        proj.lifespan -= delta;
        if (proj.lifespan <= 0) {
          proj.destroy();
        }
      }
    });

    // Update friction movement: chase player
    this.frictionGroup.getChildren().forEach((f) => {
      const angle = Phaser.Math.Angle.Between(f.x, f.y, this.player.x, this.player.y);
      f.body.setVelocity(Math.cos(angle) * f.speed, Math.sin(angle) * f.speed);
    });
  }

  /** Evaluate the level outcome when timer expires. */
  endLevel() {
    if (this.gameOver) return;
    this.gameOver = true;
    // Calculate conversion rate
    const rate = this.totalLeads ? this.converted / this.totalLeads : 0;
    // If high enough conversion triggers finish sequence, otherwise proceed/fail
    if (rate >= 0.7) {
      // Good enough to pass
      if (rate >= 0.9 && !this.finishTriggered) {
        this.finishTriggered = true;
        this.finishSequence(rate);
      } else {
        this.startNextLevel();
      }
    } else {
      // Fail the level
      this.scene.start('GameOver');
    }
  }

  /** Show a Mortal Kombat style “Finish Him” overlay. */
  finishSequence(rate) {
    // Stop spawning and moving
    this.spawnEvent.remove(false);
    // Dark overlay
    const overlay = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6).setOrigin(0);
    const title = this.add.text(this.cameras.main.centerX, 200, 'FINISH HIM!', {
      fontSize: '52px',
      fill: '#ff0000',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const instruct = this.add.text(this.cameras.main.centerX, 300, 'Press F to execute mortality', {
      fontSize: '24px',
      fill: '#ffffff',
    }).setOrigin(0.5);
    // Wait for F key
    const fKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    fKey.once('down', () => {
      // Big red splash effect on pursuer or centre
      const x = (this.frictionGroup.getChildren()[0] && this.frictionGroup.getChildren()[0].x) || this.cameras.main.centerX;
      const y = (this.frictionGroup.getChildren()[0] && this.frictionGroup.getChildren()[0].y) || this.cameras.main.centerY;
      const splash = this.add.circle(x, y, 20, 0xff4444).setDepth(20);
      this.tweens.add({
        targets: splash,
        scale: 10,
        alpha: 0,
        duration: 800,
        onComplete: () => splash.destroy(),
      });
      // Cleanup overlay and texts
      overlay.destroy();
      title.destroy();
      instruct.destroy();
      fKey.destroy();
      // Remove any friction pursuers
      this.frictionGroup.clear(true, true);
      // Proceed to next level after a short delay
      this.time.delayedCall(500, () => {
        this.startNextLevel();
      });
    });
  }

  /** Transition to the next level or victory screen. */
  startNextLevel() {
    // Determine next scene key
    if (this.levelNumber === 1) {
      this.scene.start('Level2');
    } else if (this.levelNumber === 2) {
      this.scene.start('Level3');
    } else {
      this.scene.start('Victory');
    }
  }
}

/**
 * Level 1: Mall perfume counter. Open area with no static obstacles and
 * spray as the primary attack.
 */
class Level1 extends LevelScene {
  constructor() {
    super('Level1', { number: 1, projectileType: 'spray' });
  }
}

/**
 * Level 2: Shoe store. Narrow aisles act as walls and the projectile
 * becomes a boomerang shoe.
 */
class Level2 extends LevelScene {
  constructor() {
    super('Level2', { number: 2, projectileType: 'shoe', setupLayout: () => {} });
  }
  /** Override create to build aisles then call parent */
  create() {
    // Build vertical aisle walls using static rectangles
    this.walls = this.physics.add.staticGroup();
    // Four aisle dividers evenly spaced
    const positions = [160, 320, 480, 640];
    positions.forEach((x) => {
      const rect = this.add.rectangle(x, 300, 16, 500, 0x333333).setOrigin(0.5);
      this.physics.add.existing(rect, true);
      this.walls.add(rect);
    });
    // Now call base create
    super.create();
  }
}

/**
 * Level 3: Car lot. Large cars act as static obstacles and keys scatter
 * projectiles. Magnetising effect is represented by strong radial shots.
 */
class Level3 extends LevelScene {
  constructor() {
    super('Level3', { number: 3, projectileType: 'keys', setupLayout: () => {} });
  }
  create() {
    // Build car obstacles as static rectangles
    this.walls = this.physics.add.staticGroup();
    // Place a few large cars randomly
    const cars = [
      { x: 200, y: 200, w: 80, h: 40 },
      { x: 600, y: 150, w: 80, h: 40 },
      { x: 300, y: 400, w: 100, h: 50 },
      { x: 550, y: 350, w: 100, h: 50 },
    ];
    cars.forEach((c) => {
      const rect = this.add.rectangle(c.x, c.y, c.w, c.h, 0x444444).setOrigin(0.5);
      this.physics.add.existing(rect, true);
      this.walls.add(rect);
    });
    super.create();
  }
}

/**
 * GameOver scene displays when the player loses or fails to achieve 70% conversion.
 */
class GameOver extends Phaser.Scene {
  constructor() {
    super({ key: 'GameOver' });
  }
  create() {
    const { width, height } = this.cameras.main;
    this.add.text(width / 2, height / 2 - 40, 'GAME OVER', {
      fontSize: '48px',
      fill: '#ff5555',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 20, 'Press R to Restart', {
      fontSize: '24px',
      fill: '#ffffff',
    }).setOrigin(0.5);
    const rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    rKey.once('down', () => {
      this.scene.start('Level1');
    });
  }
}

/**
 * Victory scene is shown after beating all three stages.
 */
class Victory extends Phaser.Scene {
  constructor() {
    super({ key: 'Victory' });
  }
  create() {
    const { width, height } = this.cameras.main;
    this.add.text(width / 2, height / 2 - 60, 'CONGRATULATIONS', {
      fontSize: '42px',
      fill: '#00ff88',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(width / 2, height / 2, 'You completed Conversion Quest!', {
      fontSize: '24px',
      fill: '#ffffff',
    }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 40, 'Press R to play again', {
      fontSize: '20px',
      fill: '#cccccc',
    }).setOrigin(0.5);
    const rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    rKey.once('down', () => {
      this.scene.start('Level1');
    });
  }
}

// Register scenes with the game configuration. Order matters for index 0 start.
gameConfig.scene = [Level1, Level2, Level3, GameOver, Victory];
// Create the game instance
const game = new Phaser.Game(gameConfig);
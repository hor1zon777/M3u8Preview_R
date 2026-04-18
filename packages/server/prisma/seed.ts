import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user - 生产环境必须通过环境变量设置密码
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'Admin123');
  if (!adminPassword) {
    console.error('FATAL: ADMIN_SEED_PASSWORD required in production');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log(`Admin user created: ${admin.username}`);

  // Create demo user - 生产环境必须通过环境变量设置密码
  const demoPassword = process.env.DEMO_SEED_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'Demo1234');
  if (!demoPassword) {
    console.error('FATAL: DEMO_SEED_PASSWORD required in production');
    process.exit(1);
  }
  const demoHash = await bcrypt.hash(demoPassword, 12);
  const demo = await prisma.user.upsert({
    where: { username: 'demo' },
    update: {},
    create: {
      username: 'demo',
      passwordHash: demoHash,
      role: 'USER',
      isActive: true,
    },
  });
  console.log(`Demo user created: ${demo.username}`);

  // Create categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'movies' },
      update: {},
      create: { name: '电影', slug: 'movies' },
    }),
    prisma.category.upsert({
      where: { slug: 'tv-shows' },
      update: {},
      create: { name: '电视剧', slug: 'tv-shows' },
    }),
    prisma.category.upsert({
      where: { slug: 'anime' },
      update: {},
      create: { name: '动漫', slug: 'anime' },
    }),
    prisma.category.upsert({
      where: { slug: 'documentary' },
      update: {},
      create: { name: '纪录片', slug: 'documentary' },
    }),
    prisma.category.upsert({
      where: { slug: 'live' },
      update: {},
      create: { name: '直播', slug: 'live' },
    }),
  ]);
  console.log(`${categories.length} categories created`);

  // Create tags
  const tags = await Promise.all([
    prisma.tag.upsert({ where: { name: '动作' }, update: {}, create: { name: '动作' } }),
    prisma.tag.upsert({ where: { name: '喜剧' }, update: {}, create: { name: '喜剧' } }),
    prisma.tag.upsert({ where: { name: '科幻' }, update: {}, create: { name: '科幻' } }),
    prisma.tag.upsert({ where: { name: '爱情' }, update: {}, create: { name: '爱情' } }),
    prisma.tag.upsert({ where: { name: '悬疑' }, update: {}, create: { name: '悬疑' } }),
    prisma.tag.upsert({ where: { name: '恐怖' }, update: {}, create: { name: '恐怖' } }),
    prisma.tag.upsert({ where: { name: '4K' }, update: {}, create: { name: '4K' } }),
    prisma.tag.upsert({ where: { name: '高清' }, update: {}, create: { name: '高清' } }),
  ]);
  console.log(`${tags.length} tags created`);

  // 仅在非生产环境创建测试媒体
  if (process.env.NODE_ENV !== 'production') {
    const testMedia = [
      {
        title: 'Big Buck Bunny',
        m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        description: 'Big Buck Bunny - 开源动画短片，讲述了一只大兔子的冒险故事。常用于流媒体测试。',
        year: 2008,
        rating: 7.5,
        categoryId: categories[0].id,
        tagNames: ['动作', '喜剧'],
      },
      {
        title: 'Sintel',
        m3u8Url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
        description: 'Sintel - Blender基金会制作的开源动画短片，讲述了一位年轻女孩寻找宠物龙的故事。',
        year: 2010,
        rating: 8.0,
        categoryId: categories[0].id,
        tagNames: ['动作', '科幻'],
      },
      {
        title: 'Tears of Steel',
        m3u8Url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
        description: 'Tears of Steel - Blender基金会制作的开源科幻短片。',
        year: 2012,
        rating: 6.5,
        categoryId: categories[0].id,
        tagNames: ['科幻'],
      },
      {
        title: 'HLS Test Stream 1',
        m3u8Url: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
        description: '用于测试的HLS直播流。',
        categoryId: categories[4].id,
        tagNames: ['高清'],
      },
      {
        title: 'Elephant Dream',
        m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        description: 'Elephant Dream - 世界上第一部使用开源工具制作的动画短片。',
        year: 2006,
        rating: 6.0,
        categoryId: categories[2].id,
        tagNames: ['科幻', '动作'],
      },
    ];

    for (const item of testMedia) {
      const { tagNames, ...mediaData } = item;
      const media = await prisma.media.create({
        data: mediaData,
      });

      // Link tags
      if (tagNames && tagNames.length > 0) {
        const tagRecords = tags.filter(t => tagNames.includes(t.name));
        await Promise.all(
          tagRecords.map(tag =>
            prisma.mediaTag.create({
              data: { mediaId: media.id, tagId: tag.id },
            })
          )
        );
      }
    }
    console.log(`${testMedia.length} test media created`);
  } else {
    console.log('Production mode: skipping test media creation');
  }

  // Create system settings
  await prisma.systemSetting.upsert({
    where: { key: 'siteName' },
    update: {},
    create: { key: 'siteName', value: 'M3u8 Preview' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'allowRegistration' },
    update: {},
    create: { key: 'allowRegistration', value: 'true' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'enableRateLimit' },
    update: {},
    create: { key: 'enableRateLimit', value: 'true' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'proxyAllowedExtensions' },
    update: {},
    create: { key: 'proxyAllowedExtensions', value: '.m3u8,.ts,.m4s,.mp4,.aac,.key,.jpg,.jpeg,.png,.webp' },
  });
  console.log('System settings created');

  console.log('Seed completed!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

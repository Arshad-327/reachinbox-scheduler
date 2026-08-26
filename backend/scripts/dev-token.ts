/**
 * Mints a session JWT for a local test user so protected routes can be
 * exercised with curl without doing a real Google login.
 *
 * Creates the user if it doesn't exist (idempotent, upsert on googleId).
 *
 *   npm run dev:token                    # default dev user
 *   npm run dev:token -- alice@test.dev  # a specific address
 *
 * Then:
 *   curl -H "Authorization: Bearer <token>" http://localhost:4000/api/auth/me
 */
import { PrismaClient } from '@prisma/client';
import { issueJwt, toUserDTO } from '../src/services/auth.service.js';

const prisma = new PrismaClient();

const email = process.argv[2] ?? 'dev.user@local.test';
const googleId = `dev-local-${email}`;

async function main() {
  const user = await prisma.user.upsert({
    where: { googleId },
    create: {
      googleId,
      email,
      name: 'Dev User',
      avatarUrl: null,
    },
    update: { email },
  });

  const token = issueJwt(user);

  console.log('user:', JSON.stringify(toUserDTO(user), null, 2));
  console.log('\ntoken:');
  console.log(token);
  console.log('\ntry it:');
  console.log(`  curl -s -H "Authorization: Bearer ${token}" http://localhost:4000/api/auth/me`);
}

main()
  .catch((err) => {
    console.error('dev-token failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

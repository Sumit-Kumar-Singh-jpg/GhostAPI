import 'dotenv/config';
import { internshipProvider } from '../src/internships.js';

// Check provider connectivity against a public reference page without issuing a legitimacy verdict.
try {
  const pages = await internshipProvider.fetch([
    'https://www.nasa.gov/learning-resources/internship-programs/',
  ]);
  console.log(
    JSON.stringify({
      fetched_pages: pages.length,
      readable: pages.some((page) => /intern/i.test(page.html)),
      provider: 'TinyFish Fetch',
    }),
  );
  if (!pages.some((page) => /intern/i.test(page.html))) process.exitCode = 1;
} catch {
  console.error(
    'Internship provider check failed. No credentials or provider payloads were logged.',
  );
  process.exitCode = 1;
}

import { parseEwuEmail, getRandomIcebreaker, EWU_CAMPUS_ICEBREAKERS } from './ewu_helper';

console.log('🧪 Starting Benchly Core Verification Tests...\n');

let failed = 0;

function assert(condition: boolean, testName: string) {
    if (condition) {
        console.log(`  ✅ PASS: ${testName}`);
    } else {
        console.error(`  ❌ FAIL: ${testName}`);
        failed++;
    }
}

// 1. EWU Student ID & Demographics Parser Tests
console.log('--- 1. Testing EWU Student Email Parsing (Zero-PII) ---');
const cseStudent = parseEwuEmail('2022-1-60-045@std.ewubd.edu');
assert(cseStudent.dept === 'CSE', '2022-1-60-045 should map to CSE');
assert(cseStudent.batchYear === '2022', 'Batch year should be 2022');
assert(cseStudent.semester === 'Spring', 'Semester code 1 should be Spring');
assert(cseStudent.badge === "CSE '22", "Badge should be formatted as CSE '22");

const bbaStudent = parseEwuEmail('2021-2-10-999@std.ewubd.edu');
assert(bbaStudent.dept === 'BBA', '2021-2-10-999 should map to BBA');
assert(bbaStudent.semester === 'Summer', 'Semester code 2 should be Summer');
assert(bbaStudent.badge === "BBA '21", "Badge should be formatted as BBA '21");

const pharmaStudent = parseEwuEmail('2023-3-30-101@std.ewubd.edu');
assert(pharmaStudent.dept === 'Pharmacy', '2023-3-30-101 should map to Pharmacy');
assert(pharmaStudent.semester === 'Fall', 'Semester code 3 should be Fall');

// 2. PII Sanitization Tests
console.log('\n--- 2. Testing Strict PII Sanitization ---');
function sanitize(content: string): string {
    let safe = content.replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/gi, '[CENSORED EMAIL]');
    safe = safe.replace(/(?:\+88)?01[3-9]\d{8}/g, '[CENSORED PHONE]');
    safe = safe.replace(/https?:\/\/[^\s]+/gi, '[CENSORED LINK]').replace(/www\.[^\s]+/gi, '[CENSORED LINK]');
    safe = safe.replace(/\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi, '[CENSORED SOCIAL]');
    return safe;
}

const phoneTest = sanitize('Hey call me at 01712345678 or +8801812345678');
assert(!phoneTest.includes('01712345678') && phoneTest.includes('[CENSORED PHONE]'), 'Phone numbers must be shielded');

const emailTest = sanitize('Send assignment to student123@gmail.com please');
assert(!emailTest.includes('student123@gmail.com') && emailTest.includes('[CENSORED EMAIL]'), 'Email addresses must be shielded');

const linkTest = sanitize('Check this out https://example.com/question and www.test.com');
assert(!linkTest.includes('https://') && linkTest.includes('[CENSORED LINK]'), 'Web links must be shielded');

const socialTest = sanitize('Add me on instagram or message on telegram or whatsapp');
assert(!socialTest.includes('instagram') && socialTest.includes('[CENSORED SOCIAL]'), 'Social platforms must be shielded');

// 3. Campus Icebreakers
console.log('\n--- 3. Testing EWU Campus Icebreakers ---');
assert(EWU_CAMPUS_ICEBREAKERS.length >= 20, 'Should have at least 20 curated EWU icebreakers');
const randomPrompt = getRandomIcebreaker();
assert(typeof randomPrompt === 'string' && randomPrompt.length > 10, `Icebreaker generated: "${randomPrompt}"`);

console.log('\n=======================================');
if (failed === 0) {
    console.log('🎉 ALL BENCHLY BACKEND TESTS PASSED!');
} else {
    console.error(`💥 ${failed} TESTS FAILED!`);
    process.exit(1);
}

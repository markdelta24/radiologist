#!/usr/bin/env node

/**
 * Script to verify and fix Supabase storage bucket configuration
 * This ensures the medical-frames bucket is public and has correct RLS policies
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

// Use service key if available (has admin privileges), otherwise use anon key
const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function checkBucketExists(bucketName) {
  const { data, error } = await supabase.storage.listBuckets();

  if (error) {
    console.error('Error listing buckets:', error.message);
    return false;
  }

  const bucket = data.find(b => b.name === bucketName);
  if (!bucket) {
    console.log(`Bucket '${bucketName}' does not exist`);
    return false;
  }

  console.log(`Bucket '${bucketName}' exists`);
  console.log(`  - Public: ${bucket.public}`);
  console.log(`  - ID: ${bucket.id}`);

  return bucket;
}

async function createBucket(bucketName) {
  console.log(`\nCreating bucket '${bucketName}'...`);

  const { data, error } = await supabase.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: 52428800, // 50MB per file
    allowedMimeTypes: ['image/png', 'image/jpeg']
  });

  if (error) {
    console.error('Error creating bucket:', error.message);
    return false;
  }

  console.log(`Successfully created public bucket '${bucketName}'`);
  return true;
}

async function updateBucketToPublic(bucketName) {
  console.log(`\nUpdating bucket '${bucketName}' to public...`);

  const { data, error } = await supabase.storage.updateBucket(bucketName, {
    public: true
  });

  if (error) {
    console.error('Error updating bucket:', error.message);
    console.log('\nNOTE: If you get a permission error, you need to:');
    console.log('1. Go to Supabase Dashboard > Storage');
    console.log(`2. Click on '${bucketName}' bucket`);
    console.log('3. Click the settings/configuration icon');
    console.log('4. Toggle "Public bucket" to ON');
    console.log('5. Click Save');
    return false;
  }

  console.log(`Successfully updated bucket '${bucketName}' to public`);
  return true;
}

async function testUploadAndAccess(bucketName) {
  console.log(`\nTesting upload and public access for '${bucketName}'...`);

  const testFileName = `test_${Date.now()}.png`;
  const testData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  // Upload test file
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(testFileName, testData, {
      contentType: 'image/png',
      cacheControl: '3600'
    });

  if (uploadError) {
    console.error('Upload test failed:', uploadError.message);
    return false;
  }

  console.log('Upload successful');

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(testFileName);

  const publicUrl = urlData.publicUrl;
  console.log('Public URL:', publicUrl);

  // Test fetching the file
  try {
    const response = await fetch(publicUrl);

    if (!response.ok) {
      console.error(`Fetch test failed: ${response.status} ${response.statusText}`);
      console.log('\nThis means the bucket is NOT actually public!');
      console.log('The URL is generated but returns an error when accessed.');

      // Cleanup
      await supabase.storage.from(bucketName).remove([testFileName]);
      return false;
    }

    console.log('Fetch test successful - file is publicly accessible!');

    // Cleanup
    await supabase.storage.from(bucketName).remove([testFileName]);
    return true;
  } catch (error) {
    console.error('Fetch test error:', error.message);

    // Cleanup
    await supabase.storage.from(bucketName).remove([testFileName]);
    return false;
  }
}

async function main() {
  console.log('=== Supabase Storage Bucket Configuration Tool ===\n');
  console.log('Supabase URL:', supabaseUrl);
  console.log('Using key:', supabaseServiceKey ? 'Service Role Key (admin)' : 'Anon Key (limited)');

  const bucketName = 'medical-frames';

  // Check if bucket exists
  const bucket = await checkBucketExists(bucketName);

  if (!bucket) {
    // Create bucket
    const created = await createBucket(bucketName);
    if (!created) {
      console.error('\nFailed to create bucket. Please create it manually in Supabase Dashboard.');
      process.exit(1);
    }
  } else if (!bucket.public) {
    // Bucket exists but is not public
    console.log('\nBucket exists but is NOT public. Attempting to update...');
    const updated = await updateBucketToPublic(bucketName);
    if (!updated) {
      process.exit(1);
    }
  } else {
    console.log('\nBucket is already configured as public.');
  }

  // Test upload and access
  const testPassed = await testUploadAndAccess(bucketName);

  if (testPassed) {
    console.log('\n=== SUCCESS ===');
    console.log('The medical-frames bucket is properly configured and accessible!');
    console.log('Your application should now work correctly.');
  } else {
    console.log('\n=== ACTION REQUIRED ===');
    console.log('Please manually configure the bucket in Supabase Dashboard:');
    console.log('1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/storage/buckets');
    console.log('2. Find the "medical-frames" bucket');
    console.log('3. Click the settings icon');
    console.log('4. Enable "Public bucket"');
    console.log('5. Click Save');
  }
}

main().catch(console.error);

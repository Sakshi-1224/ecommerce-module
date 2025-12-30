import { Client } from "minio";

const minioClient = new Client({
  endPoint: "localhost",
  port: 9000,          
  useSSL: false,
  accessKey: "minioadmin",
  secretKey: "minioadmin"
});

// Helper to ensure bucket exists
export const initBucket = async (bucketName) => {
  try {
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(bucketName, "us-east-1");
      console.log(`Bucket '${bucketName}' created successfully.`);
      
      // OPTIONAL: Set bucket policy to public read-only (so frontend can see images)
      // For simple dev, you can also set this in the MinIO Console manually
      const policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      };
      await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    }
  } catch (err) {
    console.error("MinIO Error:", err);
  }
};

export default minioClient;
import sharp from "sharp";
import minioClient from "../config/minio.js";
import dotenv from "dotenv";

dotenv.config();
export const uploadImageToMinio = async (file) => {
  const bucketName = "products";

  const exists = await minioClient.bucketExists(bucketName);
  if (!exists) {
    await minioClient.makeBucket(bucketName, "us-east-1");

    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Action: ["s3:GetObject"],
          Effect: "Allow",
          Principal: "*",
          Resource: [`arn:aws:s3:::${bucketName}/*`],
        },
      ],
    };
    await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    console.log(`Bucket '${bucketName}' created and set to public.`);
  }

  const objectName = `${Date.now()}-${file.originalname.split(" ").join("_")}.webp`;

  
  const optimizedBuffer = await sharp(file.buffer)
    .resize(1000, 1000, { fit: "inside" })
    .webp({ quality: 75 })
    .toBuffer();

  await minioClient.putObject(
    bucketName,
    objectName,
    optimizedBuffer,
    optimizedBuffer.length,
    {
      "Content-Type": "image/webp",
    },
  );

  return `${process.env.MINIO_BUCKET_URL}/${bucketName}/${objectName}`;
};
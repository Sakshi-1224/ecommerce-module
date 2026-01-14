import sharp from "sharp";
import minioClient from "../config/minio.js";

export const uploadImageToMinio = async (file) => {
  const bucketName = "products";

  const objectName = `${Date.now()}-${file.originalname.split(" ").join("_")}.webp`;

  // 🔥 Sharp optimization
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
      "Content-Type": "image/webp"
    }
  );

  return `http://localhost:9000/${bucketName}/${objectName}`;
};

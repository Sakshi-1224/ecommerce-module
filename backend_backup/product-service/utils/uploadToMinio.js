import minioClient from "../config/minio.js";

export const uploadImageToMinio = async (file) => {
  const bucketName = "products";
  const objectName = `${Date.now()}-${file.originalname}`;

  await minioClient.putObject(
    bucketName,
    objectName,
    file.buffer,
    {
      "Content-Type": file.mimetype
    }
  );

  // Public URL
  return `http://localhost:9000/${bucketName}/${objectName}`;
};

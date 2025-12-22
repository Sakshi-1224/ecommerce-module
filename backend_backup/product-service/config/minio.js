import { Client } from "minio";

const minioClient = new Client({
  endPoint: "localhost",
  port: 9000,          // IMPORTANT: API port
  useSSL: false,
  accessKey: "minioadmin",
  secretKey: "minioadmin"
});

export default minioClient;

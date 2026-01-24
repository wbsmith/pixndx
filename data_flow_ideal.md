This app is hosting a secure photo gallery that needs to maintain image privacy for all users, making sure images are only accessible to autheticated users who have logged in using AWS Cognito credentials.

The app needs to be responsive, so we are using the AWS CDN to cache images.

To maintain a single source of truth for the paths to the images, we are creating a "manifest" that has all the CDN URLs, which should only be accessible given a valid cookie in a user session.

The images exist in three different resolutions, all stored in S3, in a simple directory structure for s3root/small/, s3root/medium/ and s3root/full/. the small images are used for rendering thumbnails and the 'nodes' in the graph layout. the medium images are used for processing images, and the full images are rendered only in a modal (on click from one of the thumbnails in the gallery or the graph layout), where users can zoom and pan the full-resolution images.

There is additional complexity here because, for every image, we also compute a vectorized embedding of the image that is used to identify 'similar' images. this similarity is used to draw the images out in a network graph, where the (cosine) similarity score is equal to the weight of the edge between images.

The ideal flow is to have images and image metadata stored in only one place, except as required to make image and image metadata rendering very fast in the UI.

There is an 'admin' function in the app that allows users to upload NEW images that need to be processed.

When a user uploads a new image, the system needs to launch an ec2 instance to 'process' the images.

The ec2 instance must be at least a g5.xlarge GPU instance so it can hold a 4-bit QAT gemma 2 27b model, and a CLIP model.

The models are pre-cached in an EFS that is attached to the instance on launch.

The image processing steps are:
1. store the full size images in S3 in s3root/full/
2. resize the full size images into small (200px) and medium (1024px) sizes and put them in s3root/small/ and s3root/medium/ respectively.
3. pass the medium-sized image to the gemma model to generate a json document that contains the image metadata. the prompt must include the json structure so it is the same every time.
4. pass the medium-sized image to the CLIP model to generate vector embeddings of the images
5. save the vector embeddings in the attached EFS
6. use the vector embeddings to calculate similarity scores for each image relative to all other images.
7. store the per-image similarity scores so they can be quickly retrieved to draw edges in the graph layout.
8. update the manifest with new content based on the new images just processed.
9. make the new manifest automatically accessible to the frontend app via AppSync
10. shut down the ec2 instance.



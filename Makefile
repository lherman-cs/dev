IMAGE_NAME = "lherman/dev"

docker-image: Dockerfile scripts
	docker build -t ${IMAGE_NAME} .	

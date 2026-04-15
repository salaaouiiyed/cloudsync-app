.PHONY: up down build logs clean restart

up:
	docker-compose up -d

build:
	docker-compose build --no-cache

down:
	docker-compose down

logs:
	docker-compose logs -f

clean:
	docker-compose down -v --remove-orphans
	docker system prune -f

restart:
	docker-compose down && docker-compose up -d --build

status:
	docker-compose ps

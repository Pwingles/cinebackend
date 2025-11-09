# Use the official Node image
FROM node:20-alpine

# Set working directory
WORKDIR /

# Copy dependencies files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Expose port
ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

# Add api key
ENV TMDB_API_KEY=330ce6497554819b8c235f021cf221ed

# Start the app
CMD ["npm", "deploy"]
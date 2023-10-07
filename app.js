const express = require('express');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { createCanvas, loadImage } = require('canvas'); // Usar una librería de procesamiento de imágenes como canvas

const app = express();
const port = 3000;

// Carpeta donde se encuentran los archivos
const folderPath = `${__dirname}/files`;

app.use('/static', express.static(path.join(__dirname, 'static')));

// Middleware para servir archivos estáticos desde la carpeta actual
app.use(express.static(folderPath));

// Ruta principal para listar los archivos
app.get('/', (req, res) => {
  // Leer el contenido de la carpeta y generar una lista de enlaces
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      res.status(500).send('Internal Server Error');
    } else {  
      res.sendFile(path.join(__dirname, 'static', 'index.html'));
    }
  });
});

const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.md', '.mp3', '.wav', '.ogg', '.pdf'];

app.get('/files', (req, res) => {
  const mediaFolder = path.join(__dirname, 'files'); // Ruta de la carpeta de medios (ajústala según tu estructura de directorios)

  // Leer el contenido de la carpeta de medios
  fs.readdir(mediaFolder, { withFileTypes: true }, (err, items) => {
    if (err) {
      console.error('Error al leer la carpeta de medios:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      // Filtrar los archivos y carpetas por separado
      const mediaFiles = [];
      const mediaFolders = [];

      items.forEach(item => {
        if (item.isFile()) {
          const fileExtension = path.extname(item.name).toLowerCase();
          if (mediaExtensions.includes(fileExtension)) {
            mediaFiles.push(item.name);
          }
        } else if (item.isDirectory()) {
          mediaFolders.push(item.name);
        }
      });

      // Enviar la lista de nombres de archivos y carpetas multimedia en formato JSON
      res.json({ mediaFiles, mediaFolders });
    }
  });
});

// Ruta para obtener los archivos de una carpeta específica por nombre
app.get('/dir/:name', (req, res) => {
  const folderName = req.params.name;
  const folderPath = path.join(__dirname, 'files', folderName);

  // Comprobar si la carpeta existe
  fs.access(folderPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error(`La carpeta '${folderName}' no existe.`);
      res.status(404).json({ error: 'Folder Not Found' });
      return;
    }

    // Leer el contenido de la carpeta
    fs.readdir(folderPath, { withFileTypes: true }, (err, items) => {
      if (err) {
        console.error('Error al leer la carpeta:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Filtrar los archivos y carpetas por separado
        const mediaFiles = [];
        const mediaFolders = [];

        items.forEach(item => {
          if (item.isFile()) {
            const fileExtension = path.extname(item.name).toLowerCase();
            if (mediaExtensions.includes(fileExtension)) {
              mediaFiles.push(item.name);
            }
          } else if (item.isDirectory()) {
            mediaFolders.push(item.name);
          }
        });

        // Enviar la lista de nombres de archivos y carpetas multimedia en formato JSON
        res.json({ mediaFiles, mediaFolders });
      }
    });
  });
});
app.get('/preview/:file/:folder?', async (req, res) => {
  const file = req.params.file;
  const folder = req.params.folder || ''; // Si no se proporciona un folder, establecerlo como cadena vacía
  const fileExtension = path.extname(file);
  const outputFileName = `${file}.jpg`;
  const previewImagePath = `./previews/${outputFileName}`;
  const defaultImageFile = getDefaultImageByExtension(fileExtension);

  // Ruta de la imagen por defecto
  const defaultImagePath = `./previews/${defaultImageFile}`;

  // Ruta del archivo en función de la presencia del parámetro "folder"
  const filePath = folder ? `./files/${folder}/${file}` : `./files/${file}`;

  try {
    // Primero, intentar servir la vista previa desde la carpeta "previews"
    const previewImage = await fs.promises.readFile(previewImagePath);
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(previewImage, 'binary');
  } catch (err) {
    // Si no se encuentra la vista previa en "previews", llamar a la función para servir o generar la vista previa
    await serveOrGeneratePreview();
  }

  async function serveOrGeneratePreview() {
    try {
      await fs.promises.access(previewImagePath); // Intentar acceder al archivo
      // Si la vista previa existe, servirla como respuesta
      const image = await fs.promises.readFile(previewImagePath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(image, 'binary');
    } catch (err) {
      // Si la vista previa no existe, generarla y luego servirla
      try {
        if (isImage(fileExtension)) {
          await convertImageToJpg(filePath, previewImagePath);
        } else if (isVideo(fileExtension)) {
          await generatePreview(filePath, previewImagePath);
        } else {
          // Usar la imagen por defecto si no es ni imagen ni video
          const defaultImage = await fs.promises.readFile(defaultImagePath);
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          res.end(defaultImage, 'binary');
          return;
        }

        // Servir la vista previa recién generada como respuesta
        const newImage = await fs.promises.readFile(previewImagePath);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(newImage, 'binary');
      } catch (err) {
        // Si ocurre un error al generar la vista previa o al leer la imagen por defecto, servir la imagen por defecto
        const defaultImage = await fs.promises.readFile(defaultImagePath);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(defaultImage, 'binary');
      }
    }
  }
});

function isImage(extension) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
  return imageExtensions.includes(extension.toLowerCase());
}

function isVideo(extension) {
  const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
  return videoExtensions.includes(extension.toLowerCase());
}

async function convertImageToJpg(inputImagePath, outputImagePath) {
  try {
    console.log('Convirtiendo imagen:', inputImagePath);

    const image = await loadImage(inputImagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, image.width, image.height);
    await fs.promises.writeFile(outputImagePath, canvas.toBuffer('image/jpeg'));

    console.log('Imagen convertida correctamente.');
  } catch (err) {
    console.error('Error convirtiendo imagen a JPG:', err);
  }
}

async function generatePreview(videoPath, outputImagePath) {
  if (!isVideo(path.extname(videoPath))) {
    return Promise.resolve();
  }

  console.log('Generando preview para:', videoPath);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        folder: './previews',
        filename: outputImagePath.split('/').pop(),
      })
      .on('end', () => {
        console.log('Preview generada correctamente.');
        resolve();
      })
      .on('error', (err) => {
        console.error('Error generando preview:', err);
        reject(err);
      });
  });
}



app.get('/default-images/:image', (req, res) => {
  const imageName = req.params.image;
  const imagePath = `./previews/${imageName}`;
  
  // Verificar si la imagen por defecto existe
  fs.access(imagePath, (err) => {
    if (!err) {
      // Si la imagen existe, servirla
      res.sendFile(path.join(__dirname, 'previews', imageName));
    } else {
      // Si la imagen no existe, enviar una respuesta de error (por ejemplo, 404 Not Found)
      res.status(404).send('Imagen por defecto no encontrada');
    }
  });
});

function getDefaultImageByExtension(extension) {
  switch (extension.toLowerCase()) {
    case '.mp3':
      return 'default_audio.jpg';
    case '.md':
      return 'default_markdown.jpg';
    default:
      return 'default.jpg';
    case '.pdf':
      return 'default_pdf.jpg'
  }
}

// Ruta para manejar archivos específicos
app.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(folderPath, filename);

  // Utiliza el método `res.sendFile` para enviar el archivo al cliente
  res.sendFile(filePath, (err) => {
    if (err) {
      // Si hay un error al enviar el archivo, devuelve un error 404
      res.status(404).send('Archivo no encontrado');
    }
  });
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

function formatDoc(command) {
    document.execCommand(command, false, null);
}

// Save document (for demo purposes, this would involve sending the document content to the backend)
function saveDocument() {
    const content = document.getElementById('docEditor').contentDocument.body.innerHTML;
    alert("Document saved: " + content);
    // Add your AJAX request here to save the document to the database
}

// Delete document
function deleteDocument() {
    if (confirm("Are you sure you want to delete this document?")) {
        // Logic to delete the document from the backend or database
        alert("Document deleted successfully.");
        // Example AJAX request to delete the document
        fetch('/delete-document', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId: documentId })  // Pass the document ID for deletion
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // If deletion is successful, redirect or update UI
                    alert("Document deleted.");
                    location.reload();  // Refresh page or remove document from the DOM
                } else {
                    alert("Failed to delete document.");
                }
            })
            .catch(error => {
                console.error("Error deleting document:", error);
            });
    }
}
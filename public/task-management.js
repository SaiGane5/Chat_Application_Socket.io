document.getElementById("taskForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const taskName = document.getElementById("taskName").value;
    const taskDescription = document.getElementById("taskDescription").value;
    const taskDeadline = document.getElementById("taskDeadline").value;

    // Send AJAX request to save task
    fetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName, taskDescription, taskDeadline })
    }).then(response => {
        if (response.ok) {
            alert("Task created successfully");
            location.reload();
        }
    });
});
